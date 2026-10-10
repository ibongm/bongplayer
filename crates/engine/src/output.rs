//! Sound-card output with automatic recovery and a preferred device.
//!
//! An [`OutputSupervisor`] thread opens an output device through an [`AudioBackend`] and hands
//! it the engine. It keeps the music going:
//! - the **preferred device** (e.g. the DDJ-400) is used whenever it is plugged in; when it
//!   appears while something else is playing, output switches over to it;
//! - if the device in use disappears (unplugged, driver reset) or stops asking for audio, the
//!   supervisor closes the stream, gets the engine back and opens the preferred device if
//!   present, otherwise the system default;
//! - if no device can be opened it keeps retrying.
//!
//! Decks, positions and mixer settings live in the engine, so playback continues where it was.
//! Nothing in here panics on device trouble.

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

/// An output device as shown to the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    /// Stable identifier used to remember the preferred device.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    pub is_default: bool,
}

/// A way to play audio: the real sound card, or a fake one in tests.
pub trait AudioBackend: Send + 'static {
    /// A running stream. Dropping it must stop audio and drop the [`EngineSlot`].
    type Stream;

    /// Output devices currently present.
    fn devices(&mut self) -> Vec<DeviceInfo>;

    /// Opens device `id` (or the system default when `None`), sets the engine's sample rate to
    /// the device's (via [`EngineSlot::engine_mut`]) and starts the stream. Returns the device
    /// actually opened. On failure the slot is simply dropped, which returns the engine.
    fn open(
        &mut self,
        id: Option<&str>,
        slot: EngineSlot,
        lost: LostSignal,
    ) -> Result<(Self::Stream, DeviceInfo), String>;
}

enum Msg {
    DeviceLost(String),
    PreferredChanged,
    Shutdown,
}

/// Shared view of what the output is doing.
#[derive(Debug, Default)]
pub struct OutputState {
    running: AtomicBool,
    reopens: AtomicU32,
    switches: AtomicU32,
    failed_opens: AtomicU32,
    current: Mutex<Option<DeviceInfo>>,
    preferred: Mutex<Option<String>>,
    devices: Mutex<Vec<DeviceInfo>>,
    last_problem: Mutex<Option<String>>,
}

fn read<T: Clone>(m: &Mutex<T>) -> Option<T> {
    m.lock().ok().map(|g| g.clone())
}

fn write<T>(m: &Mutex<T>, value: T) {
    if let Ok(mut g) = m.lock() {
        *g = value;
    }
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
    /// Times output moved to the preferred device after it appeared.
    pub fn switches(&self) -> u32 {
        self.switches.load(Ordering::Relaxed)
    }
    /// Attempts to open a device that failed.
    pub fn failed_opens(&self) -> u32 {
        self.failed_opens.load(Ordering::Relaxed)
    }
    /// Device playing right now.
    pub fn current_device(&self) -> Option<DeviceInfo> {
        read(&self.current).flatten()
    }
    pub fn preferred_device(&self) -> Option<String> {
        read(&self.preferred).flatten()
    }
    /// Devices seen at the last check.
    pub fn devices(&self) -> Vec<DeviceInfo> {
        read(&self.devices).unwrap_or_default()
    }
    /// Most recent problem, for showing to the user.
    pub fn last_problem(&self) -> Option<String> {
        read(&self.last_problem).flatten()
    }
    fn set_problem(&self, msg: String) {
        write(&self.last_problem, Some(msg));
    }
}

/// How long the stream may stop asking for audio before it is treated as lost.
const STALL_TIMEOUT: Duration = Duration::from_secs(2);
const WATCH_INTERVAL: Duration = Duration::from_millis(100);
/// How often the device list is checked for the preferred device.
const DEVICE_SCAN_INTERVAL: Duration = Duration::from_millis(500);
/// Waiting time between attempts when no device can be opened (grows up to the maximum).
const RETRY_MIN: Duration = Duration::from_millis(100);
const RETRY_MAX: Duration = Duration::from_secs(2);
/// How long to wait for a closed stream to hand the engine back.
const RETURN_TIMEOUT: Duration = Duration::from_secs(5);

pub struct OutputSupervisor {
    control: Sender<Msg>,
    state: Arc<OutputState>,
    thread: Option<JoinHandle<Option<Engine>>>,
}

impl OutputSupervisor {
    /// Starts playing `engine`, on `preferred` if it is present, else on the default device.
    pub fn start<B: AudioBackend>(
        backend: B,
        engine: Engine,
        preferred: Option<String>,
    ) -> std::io::Result<Self> {
        let (control_tx, control_rx) = mpsc::channel();
        let state = Arc::new(OutputState::default());
        write(&state.preferred, preferred);
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

    pub fn state_arc(&self) -> Arc<OutputState> {
        Arc::clone(&self.state)
    }

    /// Sets (or clears) the preferred device; output moves to it right away if present.
    pub fn set_preferred(&self, id: Option<String>) {
        write(&self.state.preferred, id);
        let _ = self.control.send(Msg::PreferredChanged);
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
    /// The preferred device is available and not in use.
    SwitchToPreferred,
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
            let target = self.preferred_if_present();
            let slot = EngineSlot::new(e, home_tx.clone());
            match self
                .backend
                .open(target.as_deref(), slot, self.lost.clone())
            {
                Ok((stream, device)) => {
                    retry = RETRY_MIN;
                    write(&self.state.current, Some(device.clone()));
                    self.state.running.store(true, Ordering::Relaxed);
                    let waited = self.watch(&device);
                    self.state.running.store(false, Ordering::Relaxed);
                    drop(stream);
                    write(&self.state.current, None);
                    match waited {
                        Waited::Lost(reason) => {
                            self.state
                                .set_problem(format!("{} lost: {reason}", device.name));
                            self.state.reopens.fetch_add(1, Ordering::Relaxed);
                        }
                        Waited::SwitchToPreferred => {
                            self.state.switches.fetch_add(1, Ordering::Relaxed);
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
                        Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                    }
                    retry = (retry * 2).min(RETRY_MAX);
                }
            }
        }
    }

    /// The preferred device id, if one is set and currently present.
    fn preferred_if_present(&mut self) -> Option<String> {
        let devices = self.backend.devices();
        let preferred = self.state.preferred_device();
        let found = preferred.filter(|p| devices.iter().any(|d| &d.id == p));
        write(&self.state.devices, devices);
        found
    }

    /// Waits while the stream runs; returns when it is lost, stalls, the preferred device
    /// becomes available, or on shutdown.
    fn watch(&mut self, device: &DeviceInfo) -> Waited {
        let mut last_frames = self.status.frames_rendered();
        let mut last_progress = Instant::now();
        let mut last_scan = Instant::now();
        loop {
            match self.control.recv_timeout(WATCH_INTERVAL) {
                Ok(Msg::DeviceLost(reason)) => return Waited::Lost(reason),
                Ok(Msg::Shutdown) | Err(RecvTimeoutError::Disconnected) => return Waited::Shutdown,
                Ok(Msg::PreferredChanged) => {
                    last_scan = Instant::now() - DEVICE_SCAN_INTERVAL;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
            let frames = self.status.frames_rendered();
            if frames != last_frames {
                last_frames = frames;
                last_progress = Instant::now();
            } else if last_progress.elapsed() >= STALL_TIMEOUT {
                return Waited::Lost("the device stopped asking for audio".into());
            }
            if last_scan.elapsed() >= DEVICE_SCAN_INTERVAL {
                last_scan = Instant::now();
                let devices = self.backend.devices();
                let still_there = devices.iter().any(|d| d.id == device.id);
                let preferred = self.state.preferred_device();
                let switch = preferred
                    .as_ref()
                    .is_some_and(|p| p != &device.id && devices.iter().any(|d| &d.id == p));
                write(&self.state.devices, devices);
                if switch {
                    return Waited::SwitchToPreferred;
                }
                if !still_there {
                    return Waited::Lost("device no longer present".into());
                }
            }
        }
    }
}
