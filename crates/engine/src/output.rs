//! Sound-card output with automatic recovery.
//!
//! An [`OutputSupervisor`] thread opens the default output device through an [`AudioBackend`]
//! and hands it the engine. If the device disappears (unplugged, driver reset) or stops asking
//! for audio, the supervisor closes the stream, gets the engine back and opens the default
//! device again. Decks, positions and mixer settings live in the engine, so playback continues
//! where it was. Nothing in here panics on device trouble; it retries.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::engine::{Engine, EngineStatus, MAX_BLOCK};

/// Holds the engine while a stream runs it. When the stream (and with it this slot) is dropped,
/// the engine is sent back to the supervisor — whether the stream ran, failed to start, or the
/// backend gave up.
pub struct EngineSlot {
    engine: Option<Engine>,
    home: Sender<Engine>,
    scratch: Vec<f32>,
}

impl EngineSlot {
    fn new(engine: Engine, home: Sender<Engine>) -> Self {
        Self {
            engine: Some(engine),
            home,
            scratch: vec![0.0; 2 * MAX_BLOCK],
        }
    }

    /// The engine, for setup before the stream starts (e.g. setting the sample rate).
    pub fn engine_mut(&mut self) -> Option<&mut Engine> {
        self.engine.as_mut()
    }

    /// Fills a device buffer of `channels` interleaved channels. Left/right go to the first two
    /// channels, other channels get silence; a mono device gets the average. Realtime-safe.
    pub fn render<T: Copy>(&mut self, out: &mut [T], channels: usize, convert: impl Fn(f32) -> T) {
        let channels = channels.max(1);
        let Some(engine) = self.engine.as_mut() else {
            out.fill(convert(0.0));
            return;
        };
        for dev_block in out.chunks_mut(MAX_BLOCK * channels) {
            let frames = dev_block.len() / channels;
            let stereo = &mut self.scratch[..2 * frames];
            engine.process(stereo);
            for (dev, s) in dev_block
                .chunks_mut(channels)
                .zip(stereo.as_chunks::<2>().0)
            {
                match dev {
                    [m] => *m = convert((s[0] + s[1]) * 0.5),
                    [l, r, rest @ ..] => {
                        *l = convert(s[0]);
                        *r = convert(s[1]);
                        rest.fill(convert(0.0));
                    }
                    [] => {}
                }
            }
        }
    }
}

impl Drop for EngineSlot {
    fn drop(&mut self) {
        if let Some(engine) = self.engine.take() {
            // If the supervisor is gone the engine is simply dropped here.
            let _ = self.home.send(engine);
        }
    }
}

/// Tells the supervisor that the device was lost. Cheap to clone; safe to call from the
/// backend's error callback.
#[derive(Clone)]
pub struct LostSignal(Sender<Msg>);

impl LostSignal {
    pub fn device_lost(&self, reason: impl Into<String>) {
        let _ = self.0.send(Msg::DeviceLost(reason.into()));
    }
}

/// A way to play audio: the real sound card, or a fake one in tests.
pub trait AudioBackend: Send + 'static {
    /// A running stream. Dropping it must stop audio and drop the [`EngineSlot`].
    type Stream;

    /// Opens the current default output device, sets the engine's sample rate to the device's
    /// (via [`EngineSlot::engine_mut`]) and starts the stream. On failure the slot is simply
    /// dropped, which returns the engine.
    fn open_default(&mut self, slot: EngineSlot, lost: LostSignal) -> Result<Self::Stream, String>;
}

enum Msg {
    DeviceLost(String),
    Shutdown,
}

/// Shared view of what the output is doing.
#[derive(Debug, Default)]
pub struct OutputState {
    running: AtomicBool,
    reopens: AtomicU32,
    failed_opens: AtomicU32,
    last_problem: Mutex<Option<String>>,
}

impl OutputState {
    /// A stream is open and playing.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
    /// Times the output was reopened after being lost.
    pub fn reopens(&self) -> u32 {
        self.reopens.load(Ordering::Relaxed)
    }
    /// Attempts to open a device that failed.
    pub fn failed_opens(&self) -> u32 {
        self.failed_opens.load(Ordering::Relaxed)
    }
    /// Most recent problem, for showing to the user.
    pub fn last_problem(&self) -> Option<String> {
        self.last_problem.lock().ok().and_then(|g| g.clone())
    }
    fn set_problem(&self, msg: String) {
        if let Ok(mut g) = self.last_problem.lock() {
            *g = Some(msg);
        }
    }
}

/// How long the stream may stop asking for audio before it is treated as lost.
const STALL_TIMEOUT: Duration = Duration::from_secs(2);
const WATCH_INTERVAL: Duration = Duration::from_millis(250);
/// Waiting time between attempts when no device can be opened (grows up to the maximum).
const RETRY_MIN: Duration = Duration::from_millis(250);
const RETRY_MAX: Duration = Duration::from_secs(2);
/// How long to wait for a closed stream to hand the engine back.
const RETURN_TIMEOUT: Duration = Duration::from_secs(5);

pub struct OutputSupervisor {
    control: Sender<Msg>,
    state: Arc<OutputState>,
    thread: Option<JoinHandle<Option<Engine>>>,
}

impl OutputSupervisor {
    /// Starts playing `engine` on the default device of `backend`, keeping it alive.
    pub fn start<B: AudioBackend>(backend: B, engine: Engine) -> std::io::Result<Self> {
        let (control_tx, control_rx) = mpsc::channel();
        let state = Arc::new(OutputState::default());
        let worker = Worker {
            backend,
            status: engine.status_arc(),
            control: control_rx,
            lost: LostSignal(control_tx.clone()),
            state: Arc::clone(&state),
        };
        let thread = std::thread::Builder::new()
            .name("bong-output".into())
            .spawn(move || worker.run(engine))?;
        Ok(Self {
            control: control_tx,
            state,
            thread: Some(thread),
        })
    }

    pub fn state(&self) -> &OutputState {
        &self.state
    }

    /// Stops output and returns the engine (if it could be recovered from the stream).
    pub fn stop(mut self) -> Option<Engine> {
        self.shutdown()
    }

    fn shutdown(&mut self) -> Option<Engine> {
        let _ = self.control.send(Msg::Shutdown);
        self.thread.take().and_then(|t| t.join().ok()).flatten()
    }
}

impl Drop for OutputSupervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Worker<B> {
    backend: B,
    status: Arc<EngineStatus>,
    control: Receiver<Msg>,
    lost: LostSignal,
    state: Arc<OutputState>,
}

enum Waited {
    Lost(String),
    Shutdown,
}

impl<B: AudioBackend> Worker<B> {
    fn run(mut self, engine: Engine) -> Option<Engine> {
        let (home_tx, home_rx) = mpsc::channel::<Engine>();
        let mut engine = Some(engine);
        let mut retry = RETRY_MIN;
        loop {
            let e = match engine.take() {
                Some(e) => e,
                None => match home_rx.recv_timeout(RETURN_TIMEOUT) {
                    Ok(e) => e,
                    Err(_) => {
                        self.state
                            .set_problem("audio driver did not release the engine".into());
                        return None;
                    }
                },
            };
            let slot = EngineSlot::new(e, home_tx.clone());
            match self.backend.open_default(slot, self.lost.clone()) {
                Ok(stream) => {
                    retry = RETRY_MIN;
                    self.state.running.store(true, Ordering::Relaxed);
                    let waited = self.watch();
                    self.state.running.store(false, Ordering::Relaxed);
                    drop(stream);
                    match waited {
                        Waited::Lost(reason) => {
                            self.state.set_problem(format!("output lost: {reason}"));
                            self.state.reopens.fetch_add(1, Ordering::Relaxed);
                        }
                        Waited::Shutdown => return home_rx.recv_timeout(RETURN_TIMEOUT).ok(),
                    }
                }
                Err(reason) => {
                    self.state.failed_opens.fetch_add(1, Ordering::Relaxed);
                    self.state
                        .set_problem(format!("cannot open output: {reason}"));
                    match self.control.recv_timeout(retry) {
                        Ok(Msg::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                            return home_rx.recv_timeout(RETURN_TIMEOUT).ok();
                        }
                        Ok(Msg::DeviceLost(_)) | Err(RecvTimeoutError::Timeout) => {}
                    }
                    retry = (retry * 2).min(RETRY_MAX);
                }
            }
        }
    }

    /// Waits while the stream runs; returns when it is lost, stalls, or on shutdown.
    fn watch(&self) -> Waited {
        let mut last_frames = self.status.frames_rendered();
        let mut last_progress = Instant::now();
        loop {
            match self.control.recv_timeout(WATCH_INTERVAL) {
                Ok(Msg::DeviceLost(reason)) => return Waited::Lost(reason),
                Ok(Msg::Shutdown) | Err(RecvTimeoutError::Disconnected) => return Waited::Shutdown,
                Err(RecvTimeoutError::Timeout) => {}
            }
            let frames = self.status.frames_rendered();
            if frames != last_frames {
                last_frames = frames;
                last_progress = Instant::now();
            } else if last_progress.elapsed() >= STALL_TIMEOUT {
                return Waited::Lost("the device stopped asking for audio".into());
            }
        }
    }
}
