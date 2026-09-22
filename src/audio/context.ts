/**
 * Centralized AudioContext singleton and lifecycle (AGENTS.md §5).
 *
 * WebView2 boots every AudioContext in the "suspended" state — callers MUST
 * invoke ensureAudioContextRunning() from inside a user-gesture handler
 * (click, keydown) before scheduling any audio graph work. Never construct
 * `new AudioContext()` anywhere else in the codebase; always go through
 * getAudioContext().
 */

let sharedContext: AudioContext | null = null;

/** Returns the single shared AudioContext, constructing it on first access. */
export function getAudioContext(): AudioContext {
  if (sharedContext === null) {
    sharedContext = new AudioContext({ latencyHint: "interactive" });
  }
  return sharedContext;
}

/**
 * Resumes a suspended AudioContext. Must be called synchronously within (or
 * as a direct continuation of) a user gesture — WebView2 will silently
 * refuse to resume otherwise.
 */
export async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

/**
 * Closes and clears the singleton. Not used in normal app flow — exists as
 * a teardown escape hatch for tests and hot-reload scenarios.
 */
export async function closeAudioContext(): Promise<void> {
  if (sharedContext !== null && sharedContext.state !== "closed") {
    await sharedContext.close();
  }
  sharedContext = null;
}
