import { useEffect, useRef, useState } from "react";
import { onRadioTitleChanged, tuneRadioStation } from "../../services/radio";

/** Compact internet radio control (Phase 8): station URL entry, native `<audio>` playback via the local ICY-stripping proxy, and a live "now playing" title. */
export function RadioPanel() {
  const [stationUrl, setStationUrl] = useState("");
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onRadioTitleChanged((title) => setNowPlaying(title)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  async function handleTune(): Promise<void> {
    setError(null);
    try {
      const proxyUrl = await tuneRadioStation(stationUrl.trim());
      setNowPlaying(null);
      if (audioRef.current !== null) {
        audioRef.current.src = proxyUrl;
        await audioRef.current.play();
      }
    } catch (tuneError) {
      setError(tuneError instanceof Error ? tuneError.message : String(tuneError));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={stationUrl}
        onChange={(event) => setStationUrl(event.target.value)}
        placeholder="http://stream.example.com:8000/stream"
        className="w-56 rounded bg-surfaceRaised px-2 py-1.5 text-sm text-textPrimary placeholder:text-textMuted"
      />
      <button
        type="button"
        onClick={() => void handleTune()}
        disabled={stationUrl.trim().length === 0}
        className="rounded bg-surfaceRaised px-3 py-1.5 text-sm text-textPrimary hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Tune Radio
      </button>
      <audio ref={audioRef} controls className="h-8 max-w-[200px]" />
      {nowPlaying !== null && (
        <span className="max-w-[220px] truncate text-sm text-textMuted">{nowPlaying}</span>
      )}
      {error !== null && (
        <span className="max-w-[220px] truncate text-sm text-red-400">{error}</span>
      )}
    </div>
  );
}
