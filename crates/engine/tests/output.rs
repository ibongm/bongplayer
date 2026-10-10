//! M1 acceptance: output device lost → engine reopens the default device without panicking,
//! and playback continues from where it was.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use engine::output::{AudioBackend, EngineSlot, LostSignal, OutputSupervisor};
use engine::{new_engine, Command, DeckId, Engine, EngineHandle, TrackBuffer};

/// A pretend sound card. Tests can unplug it, make it hang, or make opening fail.
#[derive(Clone, Default)]
struct FakeCard {
    unplug: Arc<AtomicBool>,
    hang: Arc<AtomicBool>,
    fail_next_opens: Arc<AtomicU32>,
    opens: Arc<AtomicU32>,
    /// Sample rate of each successfully opened "device".
    rates: Arc<Mutex<Vec<u32>>>,
    next_rate: Arc<AtomicU32>,
}

struct FakeStream {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for FakeStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl AudioBackend for FakeCard {
    type Stream = FakeStream;

    fn open_default(
        &mut self,
        mut slot: EngineSlot,
        lost: LostSignal,
    ) -> Result<FakeStream, String> {
        if self.fail_next_opens.load(Ordering::Relaxed) > 0 {
            self.fail_next_opens.fetch_sub(1, Ordering::Relaxed);
            return Err("no device plugged in".into());
        }
        self.opens.fetch_add(1, Ordering::Relaxed);
        let rate = self.next_rate.load(Ordering::Relaxed).max(8_000);
        if let Some(e) = slot.engine_mut() {
            e.set_sample_rate(rate);
        }
        self.rates.lock().expect("rates").push(rate);
        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = Arc::clone(&stop);
        let unplug = Arc::clone(&self.unplug);
        let hang = Arc::clone(&self.hang);
        let thread = std::thread::spawn(move || {
            // Two main channels plus two extra, like a 4-channel DJ controller.
            let mut buf = vec![0.0f32; 4 * 256];
            while !stop2.load(Ordering::Relaxed) {
                if unplug.swap(false, Ordering::Relaxed) {
                    lost.device_lost("fake card unplugged");
                    while !stop2.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    break;
                }
                if !hang.load(Ordering::Relaxed) {
                    slot.render(&mut buf, 4, |s| s);
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            drop(slot);
        });
        Ok(FakeStream {
            stop,
            thread: Some(thread),
        })
    }
}

fn wait_for(what: &str, timeout: Duration, mut cond: impl FnMut() -> bool) {
    let start = Instant::now();
    while !cond() {
        assert!(start.elapsed() < timeout, "timed out waiting for: {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn playing_engine() -> (EngineHandle, Engine) {
    let (mut handle, engine) = new_engine(48_000);
    let samples = vec![0.2f32; 2 * 48_000 * 60];
    handle
        .load(
            DeckId::A,
            Arc::new(TrackBuffer::from_interleaved(48_000, &samples)),
        )
        .expect("load");
    handle.send(Command::Play(DeckId::A)).expect("play");
    (handle, engine)
}

fn card_at(rate: u32) -> FakeCard {
    let card = FakeCard::default();
    card.next_rate.store(rate, Ordering::Relaxed);
    card
}

#[test]
fn unplugged_device_is_reopened_and_playback_continues() {
    let (handle, engine) = playing_engine();
    let card = card_at(48_000);
    let sup = OutputSupervisor::start(card.clone(), engine).expect("start");

    let pos = || handle.status().deck(DeckId::A).position();
    wait_for("playback to start", Duration::from_secs(5), || {
        pos() > 4_800.0
    });

    // The replacement default device runs at 44.1 kHz.
    card.next_rate.store(44_100, Ordering::Relaxed);
    let before = pos();
    card.unplug.store(true, Ordering::Relaxed);

    wait_for("reopen", Duration::from_secs(5), || {
        sup.state().reopens() == 1 && sup.state().is_running()
    });
    wait_for("playback to continue", Duration::from_secs(5), || {
        pos() > before + 4_800.0
    });

    assert_eq!(card.opens.load(Ordering::Relaxed), 2);
    assert_eq!(*card.rates.lock().expect("rates"), vec![48_000, 44_100]);
    assert_eq!(handle.status().sample_rate(), 44_100);
    assert!(
        handle.status().deck(DeckId::A).is_playing(),
        "still playing"
    );
    assert!(sup
        .state()
        .last_problem()
        .unwrap_or_default()
        .contains("unplugged"));

    let engine = sup.stop().expect("engine returned on stop");
    assert_eq!(engine.sample_rate(), 44_100);
}

#[test]
fn no_device_for_a_while_then_one_appears() {
    let (handle, engine) = playing_engine();
    let card = card_at(48_000);
    card.fail_next_opens.store(3, Ordering::Relaxed);
    let sup = OutputSupervisor::start(card.clone(), engine).expect("start");

    wait_for("eventual open", Duration::from_secs(10), || {
        sup.state().is_running()
    });
    assert_eq!(sup.state().failed_opens(), 3);
    wait_for("playback", Duration::from_secs(5), || {
        handle.status().deck(DeckId::A).position() > 4_800.0
    });
    assert!(sup.stop().is_some());
}

#[test]
fn a_device_that_stops_asking_for_audio_is_treated_as_lost() {
    let (handle, engine) = playing_engine();
    let card = card_at(48_000);
    let sup = OutputSupervisor::start(card.clone(), engine).expect("start");
    wait_for("playback", Duration::from_secs(5), || {
        handle.status().deck(DeckId::A).position() > 4_800.0
    });

    card.hang.store(true, Ordering::Relaxed);
    // The watchdog fires after ~2 s without audio being requested.
    wait_for("watchdog reopen", Duration::from_secs(6), || {
        sup.state().reopens() >= 1
    });
    card.hang.store(false, Ordering::Relaxed);
    let before = handle.status().deck(DeckId::A).position();
    wait_for("playback after watchdog", Duration::from_secs(5), || {
        handle.status().deck(DeckId::A).position() > before + 4_800.0
    });
    assert!(sup
        .state()
        .last_problem()
        .unwrap_or_default()
        .contains("stopped asking"));
    assert!(sup.stop().is_some());
}
