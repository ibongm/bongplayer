//! M1 acceptance: output device lost → engine reopens the default device without panicking.
//! M2 acceptance: device hot-plug — preferred device appears → switch; disappears → fall back;
//! no gap > 1 s.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use engine::output::{AudioBackend, DeviceInfo, EngineSlot, LostSignal, OutputSupervisor};
use engine::{new_engine, Command, DeckId, Engine, EngineHandle, TrackBuffer};

#[derive(Clone)]
struct FakeDevice {
    id: &'static str,
    rate: u32,
}

/// A pretend sound system. Devices can be plugged in and out; a device can hang; opening can
/// be made to fail. Every buffer the "hardware" asks for is logged with its time.
#[derive(Clone, Default)]
struct FakeSystem {
    /// Present devices; the first one is the system default.
    devices: Arc<Mutex<Vec<FakeDevice>>>,
    hang: Arc<AtomicBool>,
    opens: Arc<Mutex<Vec<&'static str>>>,
    callbacks: Arc<Mutex<Vec<(Instant, &'static str)>>>,
    failed: Arc<AtomicU32>,
}

impl FakeSystem {
    fn with(devices: &[(&'static str, u32)]) -> Self {
        let s = Self::default();
        for &(id, rate) in devices {
            s.plug(id, rate);
        }
        s
    }
    fn plug(&self, id: &'static str, rate: u32) {
        self.devices
            .lock()
            .expect("lock")
            .push(FakeDevice { id, rate });
    }
    fn unplug(&self, id: &str) {
        self.devices.lock().expect("lock").retain(|d| d.id != id);
    }
    fn present(&self, id: &str) -> bool {
        self.devices
            .lock()
            .expect("lock")
            .iter()
            .any(|d| d.id == id)
    }
    fn opens(&self) -> Vec<&'static str> {
        self.opens.lock().expect("lock").clone()
    }
    /// Longest time the hardware went without being given audio, after `since`.
    fn longest_gap_since(&self, since: Instant) -> Duration {
        let log = self.callbacks.lock().expect("lock");
        let times: Vec<Instant> = log
            .iter()
            .map(|(t, _)| *t)
            .filter(|t| *t >= since)
            .collect();
        times
            .windows(2)
            .map(|w| w[1] - w[0])
            .max()
            .unwrap_or_default()
    }
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

impl AudioBackend for FakeSystem {
    type Stream = FakeStream;

    fn devices(&mut self) -> Vec<DeviceInfo> {
        let devs = self.devices.lock().expect("lock");
        devs.iter()
            .enumerate()
            .map(|(i, d)| DeviceInfo {
                id: d.id.to_string(),
                name: format!("Fake {}", d.id),
                is_default: i == 0,
            })
            .collect()
    }

    fn open(
        &mut self,
        id: Option<&str>,
        mut slot: EngineSlot,
        lost: LostSignal,
    ) -> Result<(FakeStream, DeviceInfo), String> {
        let dev = {
            let devs = self.devices.lock().expect("lock");
            match id {
                Some(id) => devs.iter().find(|d| d.id == id).cloned(),
                None => devs.first().cloned(),
            }
        };
        let Some(dev) = dev else {
            self.failed.fetch_add(1, Ordering::Relaxed);
            return Err("no device plugged in".into());
        };
        self.opens.lock().expect("lock").push(dev.id);
        if let Some(e) = slot.engine_mut() {
            e.set_sample_rate(dev.rate);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = Arc::clone(&stop);
        let system = self.clone();
        let id = dev.id;
        let thread = std::thread::spawn(move || {
            // Two main channels plus two extra, like a 4-channel DJ controller.
            let mut buf = vec![0.0f32; 4 * 128];
            while !stop2.load(Ordering::Relaxed) {
                if !system.present(id) {
                    // What WASAPI reports when a device is unplugged.
                    lost.device_lost(format!("{id} unplugged"));
                    while !stop2.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    break;
                }
                if !system.hang.load(Ordering::Relaxed) {
                    slot.render(&mut buf, 4, |s| s);
                    system
                        .callbacks
                        .lock()
                        .expect("lock")
                        .push((Instant::now(), id));
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            drop(slot);
        });
        let info = DeviceInfo {
            id: dev.id.to_string(),
            name: format!("Fake {}", dev.id),
            is_default: false,
        };
        Ok((
            FakeStream {
                stop,
                thread: Some(thread),
            },
            info,
        ))
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

fn position(handle: &EngineHandle) -> f64 {
    handle.status().deck(DeckId::A).position()
}

fn current(sup: &OutputSupervisor) -> Option<String> {
    sup.state().current_device().map(|d| d.id)
}

const ONE_SECOND: Duration = Duration::from_secs(1);

#[test]
fn unplugged_device_is_reopened_on_the_default_and_playback_continues() {
    let (handle, engine) = playing_engine();
    let system = FakeSystem::with(&[("usb-card", 48_000), ("speakers", 44_100)]);
    let sup = OutputSupervisor::start(system.clone(), engine, None).expect("start");

    wait_for("playback to start", Duration::from_secs(5), || {
        position(&handle) > 4_800.0
    });
    assert_eq!(current(&sup).as_deref(), Some("usb-card"));

    let before = position(&handle);
    let t = Instant::now();
    system.unplug("usb-card");
    wait_for("reopen on speakers", Duration::from_secs(5), || {
        current(&sup).as_deref() == Some("speakers")
    });
    wait_for("playback to continue", Duration::from_secs(5), || {
        position(&handle) > before + 4_800.0
    });

    assert_eq!(system.opens(), vec!["usb-card", "speakers"]);
    assert_eq!(handle.status().sample_rate(), 44_100);
    assert!(
        handle.status().deck(DeckId::A).is_playing(),
        "still playing"
    );
    assert_eq!(sup.state().reopens(), 1);
    let gap = system.longest_gap_since(t);
    assert!(gap < ONE_SECOND, "silence of {gap:?} while recovering");
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
    let system = FakeSystem::default();
    let sup = OutputSupervisor::start(system.clone(), engine, None).expect("start");

    wait_for("some failed attempts", Duration::from_secs(5), || {
        system.failed.load(Ordering::Relaxed) >= 3
    });
    assert!(!sup.state().is_running());
    system.plug("speakers", 48_000);
    wait_for("eventual open", Duration::from_secs(5), || {
        sup.state().is_running()
    });
    wait_for("playback", Duration::from_secs(5), || {
        position(&handle) > 4_800.0
    });
    assert!(sup.stop().is_some());
}

#[test]
fn a_device_that_stops_asking_for_audio_is_treated_as_lost() {
    let (handle, engine) = playing_engine();
    let system = FakeSystem::with(&[("speakers", 48_000)]);
    let sup = OutputSupervisor::start(system.clone(), engine, None).expect("start");
    wait_for("playback", Duration::from_secs(5), || {
        position(&handle) > 4_800.0
    });

    system.hang.store(true, Ordering::Relaxed);
    // The watchdog fires after ~2 s without audio being requested.
    wait_for("watchdog reopen", Duration::from_secs(6), || {
        sup.state().reopens() >= 1
    });
    system.hang.store(false, Ordering::Relaxed);
    let before = position(&handle);
    wait_for("playback after watchdog", Duration::from_secs(5), || {
        position(&handle) > before + 4_800.0
    });
    assert!(sup
        .state()
        .last_problem()
        .unwrap_or_default()
        .contains("stopped asking"));
    assert!(sup.stop().is_some());
}

#[test]
fn preferred_device_appears_switch_disappears_fall_back_without_gaps() {
    let (handle, engine) = playing_engine();
    let system = FakeSystem::with(&[("speakers", 48_000)]);
    let sup =
        OutputSupervisor::start(system.clone(), engine, Some("ddj-400".into())).expect("start");

    // Preferred device not plugged in: plays on the default.
    wait_for("playback on speakers", Duration::from_secs(5), || {
        position(&handle) > 4_800.0
    });
    assert_eq!(current(&sup).as_deref(), Some("speakers"));

    // The DJ plugs in the controller: output moves there.
    let t = Instant::now();
    let before = position(&handle);
    system.plug("ddj-400", 44_100);
    wait_for("switch to ddj-400", Duration::from_secs(5), || {
        current(&sup).as_deref() == Some("ddj-400")
    });
    wait_for("playback on ddj-400", Duration::from_secs(5), || {
        position(&handle) > before + 4_800.0
    });
    let gap = system.longest_gap_since(t);
    assert!(gap < ONE_SECOND, "switching left {gap:?} of silence");
    assert_eq!(sup.state().switches(), 1);
    assert_eq!(handle.status().sample_rate(), 44_100);

    // The controller is unplugged: back to the speakers, music keeps going.
    let t = Instant::now();
    let before = position(&handle);
    system.unplug("ddj-400");
    wait_for("fall back to speakers", Duration::from_secs(5), || {
        current(&sup).as_deref() == Some("speakers")
    });
    wait_for("playback continues", Duration::from_secs(5), || {
        position(&handle) > before + 4_800.0
    });
    let gap = system.longest_gap_since(t);
    assert!(gap < ONE_SECOND, "fall-back left {gap:?} of silence");

    // Plugged in again: back to the controller.
    system.plug("ddj-400", 44_100);
    wait_for("switch back", Duration::from_secs(5), || {
        current(&sup).as_deref() == Some("ddj-400")
    });
    assert_eq!(
        system.opens(),
        vec!["speakers", "ddj-400", "speakers", "ddj-400"]
    );
    assert!(handle.status().deck(DeckId::A).is_playing());
    assert!(sup.stop().is_some());
}

#[test]
fn choosing_a_preferred_device_while_playing_switches_to_it() {
    let (handle, engine) = playing_engine();
    let system = FakeSystem::with(&[("speakers", 48_000), ("ddj-400", 48_000)]);
    let sup = OutputSupervisor::start(system.clone(), engine, None).expect("start");
    wait_for("playback", Duration::from_secs(5), || {
        position(&handle) > 4_800.0
    });
    assert_eq!(current(&sup).as_deref(), Some("speakers"));
    assert_eq!(sup.state().devices().len(), 2);

    sup.set_preferred(Some("ddj-400".into()));
    wait_for("switch", Duration::from_secs(5), || {
        current(&sup).as_deref() == Some("ddj-400")
    });
    assert_eq!(sup.state().preferred_device().as_deref(), Some("ddj-400"));
    assert!(sup.stop().is_some());
}
