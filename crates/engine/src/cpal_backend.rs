//! The real sound card through `cpal` (WASAPI on Windows).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample};

use crate::output::{AudioBackend, DeviceInfo, EngineSlot, LostSignal};

/// Opens output devices of the system's default audio host.
#[derive(Debug, Default)]
pub struct CpalBackend;

fn device_id(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn device_name(device: &cpal::Device) -> String {
    device
        .description()
        .map(|d| d.to_string())
        .unwrap_or_else(|_| "unknown device".into())
}

impl AudioBackend for CpalBackend {
    type Stream = cpal::Stream;

    fn devices(&mut self) -> Vec<DeviceInfo> {
        let host = cpal::default_host();
        let default_id = host.default_output_device().and_then(|d| device_id(&d));
        let Ok(devices) = host.output_devices() else {
            return Vec::new();
        };
        devices
            .filter_map(|d| {
                let id = device_id(&d)?;
                Some(DeviceInfo {
                    is_default: default_id.as_deref() == Some(id.as_str()),
                    name: device_name(&d),
                    id,
                })
            })
            .collect()
    }

    fn open(
        &mut self,
        id: Option<&str>,
        mut slot: EngineSlot,
        lost: LostSignal,
    ) -> Result<(cpal::Stream, DeviceInfo), String> {
        let host = cpal::default_host();
        let default_id = host.default_output_device().and_then(|d| device_id(&d));
        let device = match id {
            Some(wanted) => host
                .output_devices()
                .map_err(|e| e.to_string())?
                .find(|d| device_id(d).as_deref() == Some(wanted))
                .ok_or_else(|| format!("device {wanted} not found"))?,
            None => host
                .default_output_device()
                .ok_or_else(|| "no output device found".to_string())?,
        };
        let info = DeviceInfo {
            id: device_id(&device).unwrap_or_default(),
            name: device_name(&device),
            is_default: false,
        };
        let info = DeviceInfo {
            is_default: default_id.as_deref() == Some(info.id.as_str()),
            ..info
        };
        let name = info.name.clone();
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
        Ok((stream, info))
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
