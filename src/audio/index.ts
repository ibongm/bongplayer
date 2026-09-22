export { getAudioContext, ensureAudioContextRunning, closeAudioContext } from "./context";
export * from "./nodes";

export { decodeAudioFile, decodeViaBrowser } from "./decode";
export type { DecodedAudio } from "./decode";

export { extractPeaks, decodeAndExtractPeaks } from "./waveform";
export type { WaveformPeaks } from "./waveform";
