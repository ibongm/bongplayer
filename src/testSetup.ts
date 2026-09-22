/**
 * Vitest global setup: polyfills the real-time AudioContext (and
 * OfflineAudioContext, for consistency) globally so that code calling the
 * bare `new AudioContext()` global — as src/audio/context.ts's
 * getAudioContext() singleton does, matching how it's used in the real
 * browser/WebView2 app — also works under Node. Verified empirically:
 * node-web-audio-api's AudioContext.currentTime genuinely advances with
 * wall-clock time, so real-time-dependent code (src/audio/deckEngine.ts,
 * src/audio/masterGraph.ts, and anything built on them) becomes testable
 * against real DSP behavior instead of staying permanently untested.
 */

import { AudioContext, OfflineAudioContext } from "node-web-audio-api";

globalThis.AudioContext = AudioContext;
globalThis.OfflineAudioContext = OfflineAudioContext;
