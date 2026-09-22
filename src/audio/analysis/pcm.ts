/** Sums all channels of a decoded buffer down to mono, for analysis functions that expect single-channel PCM. */
export function monoDownmix(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  const channelCount = buffer.numberOfChannels;
  for (let channel = 0; channel < channelCount; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      mono[i] += data[i] / channelCount;
    }
  }
  return mono;
}
