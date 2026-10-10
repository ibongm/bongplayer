//! The real sound card through `cpal` (WASAPI on Windows), default output device.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample};

use crate::output::{AudioBackend, EngineSlot, LostSignal};

/// Opens the system's default output device each time it is asked to.
#[derive(Debug, Default)]
pub struct CpalBackend;

impl AudioBackend for CpalBackend {
    type Stream = cpal::Stream;

    fn open_default(
        &mut self,
        mut slot: EngineSlot,
        lost: LostSignal,
    ) -> Result<cpal::Stream, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no output device found".to_string())?;
        let name = device
            .description()
            .map(|d| d.to_string())
            .unwrap_or_else(|_| "unknown device".into());
        let supported = device
            .default_output_config()
            .map_err(|e| format!("{name}: {e}"))?;
        let config = supported.config();
        if let Some(engine) = slot.engine_mut() {
            engine.set_sample_rate(config.sample_rate);
        }
        let stream = match supported.sample_format() {
            SampleFormat::F32 => build::<f32>(&device, config, slot, lost),
            SampleFormat::I16 => build::<i16>(&device, config, slot, lost),
            SampleFormat::I32 => build::<i32>(&device, config, slot, lost),
            other => Err(format!("unsupported sample format {other}")),
        }
        .map_err(|e| format!("{name}: {e}"))?;
        stream.play().map_err(|e| format!("{name}: {e}"))?;
        Ok(stream)
    }
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut slot: EngineSlot,
    lost: LostSignal,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let channels = usize::from(config.channels);
    device
        .build_output_stream::<T, _, _>(
            config,
            move |data: &mut [T], _| slot.render(data, channels, T::from_sample_),
            move |err| match err.kind() {
                ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated => {
                    lost.device_lost(err.to_string());
                }
                // Glitches and automatic re-routing are survivable; the watchdog catches
                // anything that actually stops the audio.
                _ => {}
            },
            None,
        )
        .map_err(|e| e.to_string())
}
