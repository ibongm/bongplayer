// A full deck: track info, overview waveform, loops, hot cues, platter, pitch, transport.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { backend } from "../../ipc/backend";
import type { DeckName, DeckSnapshot } from "../../ipc/types";
import { notify, refresh, run, status } from "../../state/app";
import { useStore } from "../../state/store";
import { context2d, cssColor, ensureWaveform, livePosition, mixer, onFrame, send, waveforms } from "../../state/ui";
import { Fader } from "../controls/Fader";
import { formatTime } from "../TrackTable";
import { useLiveText } from "./useLiveText";

const KEYS = {
  A: { play: "F1", cue: "F2", cup: "F3", sync: "F4", cuePrefix: "" },
  B: { play: "F5", cue: "F6", cup: "F7", sync: "F8", cuePrefix: "Shift+" },
} as const;

function useDeck<T>(index: 0 | 1, pick: (d: DeckSnapshot) => T, fallback: T): T {
  return useStore(status, (s) => {
    const d = s?.decks[index];
    return d ? pick(d) : fallback;
  });
}

function Btn({
  children,
  title,
  onClick,
  active = false,
  disabled = false,
  wide = false,
  className = "",
  ...rest
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  wide?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title" | "children">): ReactNode {
  return (
    <button
      type="button"
      title={title}
      aria-label={title.split(" (")[0]}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[12px] font-semibold disabled:opacity-40 ${
        active ? "border-accent bg-accent/25 text-text" : "border-border bg-surface-raised hover:bg-accent/20"
      } ${wide ? "min-w-14" : "min-w-9"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ----- overview waveform -----

function Overview({ deck, index }: { deck: DeckName; index: 0 | 1 }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const trackId = useDeck(index, (d) => d.trackId, null);
  const ready = useDeck(index, (d) => d.waveform === "ready", false);

  useEffect(() => {
    if (ready && trackId !== null) void ensureWaveform(trackId);
  }, [ready, trackId]);

  useEffect(
    () =>
      onFrame(() => {
        const ctx = context2d(ref.current);
        const canvas = ref.current;
        if (!ctx || !canvas) return;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        const d = status.get()?.decks[index];
        const wave = d?.trackId != null ? waveforms.get().get(d.trackId) : undefined;
        const duration = d?.duration ?? null;
        if (!d || !wave || duration === null || duration <= 0) return;
        const pos = livePosition(index);
        const played = (pos / duration) * w;
        const binsPerPx = wave.count / w;
        for (let x = 0; x < w; x++) {
          const from = Math.floor(x * binsPerPx);
          const to = Math.max(from + 1, Math.floor((x + 1) * binsPerPx));
          let peak = 0;
          for (let b = from; b < to && b < wave.count; b++) peak = Math.max(peak, wave.bins[b * 4] ?? 0);
          const amp = (peak / 255) * (h / 2 - 1);
          ctx.fillStyle = x < played ? cssColor("--color-text-muted") : cssColor("--color-accent");
          ctx.fillRect(x, h / 2 - amp, 1, amp * 2);
        }
        // Loop region, cues, playhead.
        if (d.loopIn !== null && d.loopOut !== null) {
          ctx.fillStyle = d.loopActive ? "rgba(56,189,248,0.25)" : "rgba(139,151,168,0.2)";
          ctx.fillRect((d.loopIn / duration) * w, 0, ((d.loopOut - d.loopIn) / duration) * w, h);
        }
        ctx.fillStyle = cssColor("--color-accent-2");
        d.cues.forEach((c) => {
          if (c !== null) ctx.fillRect((c / duration) * w - 1, 0, 2, h);
        });
        ctx.fillStyle = cssColor("--color-text");
        ctx.fillRect(played - 1, 0, 2, h);
      }),
    [index],
  );

  return (
    <canvas
      ref={ref}
      role="slider"
      tabIndex={-1}
      aria-label={`Deck ${deck} overview — click to jump`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      title="Overview of the whole track — click to jump there"
      className="h-10 w-full cursor-pointer rounded bg-bg"
      onClick={(e) => {
        const d = status.get()?.decks[index];
        if (!d?.duration) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (r.width <= 0) return;
        const seconds = ((e.clientX - r.left) / r.width) * d.duration;
        void send({ type: "seek", deck, seconds: Math.max(0, Math.min(d.duration, seconds)) }, `Deck ${deck}`);
      }}
    />
  );
}

// ----- platter -----

const SECONDS_PER_TURN = 60 / 33.333;

function Platter({ deck, index, size }: { deck: DeckName; index: 0 | 1; size: number }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const grab = useRef<{ angle: number } | null>(null);
  const wheelBend = useRef<number | null>(null);

  useEffect(
    () =>
      onFrame(() => {
        const ctx = context2d(ref.current);
        if (!ctx) return;
        const s = size;
        const c = s / 2;
        ctx.clearRect(0, 0, s, s);
        const d = status.get()?.decks[index];
        ctx.beginPath();
        ctx.arc(c, c, c - 2, 0, Math.PI * 2);
        ctx.fillStyle = cssColor("--color-surface-raised");
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = cssColor("--color-border");
        ctx.stroke();
        if (d?.loaded && d.duration) {
          // Progress ring.
          ctx.beginPath();
          ctx.arc(c, c, c - 4, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * livePosition(index)) / d.duration);
          ctx.strokeStyle = cssColor("--color-accent");
          ctx.lineWidth = 4;
          ctx.stroke();
        }
        const turn = ((d ? livePosition(index) : 0) / SECONDS_PER_TURN) * Math.PI * 2;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(turn);
        ctx.fillStyle = d?.scratching ? cssColor("--color-accent-2") : cssColor("--color-text");
        ctx.fillRect(-2, -(c - 12), 4, c * 0.35);
        ctx.restore();
        ctx.fillStyle = cssColor("--color-accent");
        ctx.font = `900 ${Math.round(s * 0.22)}px Segoe UI, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(deck, c, c);
      }),
    [deck, index, size],
  );

  const angleOf = (e: { clientX: number; clientY: number }, el: Element): number => {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Deck ${deck} platter`}
      title="Platter — drag around to scratch (forward / back); mouse wheel nudges (playing) or moves (paused)"
      className="cursor-grab touch-none active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        grab.current = { angle: angleOf(e, el) };
        void send({ type: "scratchStart", deck });
        const move = (ev: PointerEvent): void => {
          if (!grab.current) return;
          const a = angleOf(ev, el);
          let delta = a - grab.current.angle;
          if (delta > Math.PI) delta -= Math.PI * 2;
          if (delta < -Math.PI) delta += Math.PI * 2;
          grab.current.angle = a;
          if (delta !== 0) {
            void send({ type: "scratchMove", deck, seconds: (delta / (Math.PI * 2)) * SECONDS_PER_TURN });
          }
        };
        const up = (): void => {
          grab.current = null;
          void send({ type: "scratchEnd", deck });
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onWheel={(e) => {
        const d = status.get()?.decks[index];
        if (!d?.loaded) return;
        const dir = e.deltaY < 0 ? 1 : -1;
        if (d.playing) {
          void send({ type: "bend", deck, bend: 0.03 * dir });
          if (wheelBend.current !== null) window.clearTimeout(wheelBend.current);
          wheelBend.current = window.setTimeout(() => {
            void send({ type: "bend", deck, bend: 0 });
          }, 150);
        } else {
          void send({ type: "seek", deck, seconds: Math.max(0, d.position + 0.05 * dir) });
        }
      }}
    />
  );
}

// ----- pads, loops, pitch, transport -----

function HotCuePads({ deck, index }: { deck: DeckName; index: 0 | 1 }): ReactNode {
  const cues = useStore(status, (s) => JSON.stringify(s?.decks[index].cues ?? []));
  const list = JSON.parse(cues) as (number | null)[];
  const prefix = KEYS[deck].cuePrefix;
  return (
    <div className="grid grid-cols-4 gap-1" role="group" aria-label={`Deck ${deck} hot cues`}>
      {Array.from({ length: 8 }, (_, slot) => {
        const at = list[slot] ?? null;
        const label = `Hot cue ${slot + 1}`;
        return (
          <button
            key={slot}
            type="button"
            aria-label={`${label} ${at === null ? "(empty)" : `at ${formatTime(at)}`}`}
            title={
              at === null
                ? `${label}: empty — click to set here (${prefix}${slot + 1})`
                : `${label} at ${formatTime(at)} — click to jump (${prefix}${slot + 1}); right-click or Shift+click to clear`
            }
            className={`h-8 rounded border text-[12px] font-bold ${
              at === null ? "border-border bg-bg text-muted hover:bg-surface-raised" : "border-accent-2 bg-accent-2/30 text-text hover:bg-accent-2/50"
            }`}
            onClick={(e) => {
              if (at !== null && e.shiftKey) void backend().hotCueClear(deck, slot).then((r) => run(r, label));
              else if (at === null) void backend().hotCueSet(deck, slot).then((r) => run(r, label));
              else void send({ type: "jumpHotCue", deck, slot }, label);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (at !== null) void backend().hotCueClear(deck, slot).then((r) => run(r, label));
            }}
          >
            {slot + 1}
          </button>
        );
      })}
    </div>
  );
}

function LoopPanel({ deck, index }: { deck: DeckName; index: 0 | 1 }): ReactNode {
  const active = useDeck(index, (d) => d.loopActive, false);
  const hasLoop = useDeck(index, (d) => d.loopIn !== null && d.loopOut !== null, false);
  const length = useDeck(index, (d) => (d.loopIn !== null && d.loopOut !== null ? d.loopOut - d.loopIn : null), null);
  const bpm = useDeck(index, (d) => d.trackBpm, null);
  const beats = length !== null && bpm ? Math.round(((length * bpm) / 60) * 100) / 100 : null;
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={`Deck ${deck} loops`}>
      <div className="flex flex-wrap gap-1">
        {[1, 2, 4, 8, 16, 32].map((n) => (
          <Btn
            key={n}
            title={`Loop ${n} beat${n === 1 ? "" : "s"} from here`}
            active={active && beats === n}
            onClick={() => void send({ type: "autoLoop", deck, beats: n }, `Loop ${n}`)}
          >
            {n}
          </Btn>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <Btn title="Loop IN at the current position" onClick={() => void send({ type: "loopIn", deck })}>
          IN
        </Btn>
        <Btn title="Loop OUT at the current position (starts the loop)" onClick={() => void send({ type: "loopOut", deck })}>
          OUT
        </Btn>
        <Btn title="Halve the loop" disabled={!hasLoop} onClick={() => void send({ type: "loopResize", deck, factor: 0.5 })}>
          ½
        </Btn>
        <Btn title="Double the loop" disabled={!hasLoop} onClick={() => void send({ type: "loopResize", deck, factor: 2 })}>
          ×2
        </Btn>
        <Btn
          wide
          title={active ? "Exit the loop (playback continues)" : "Re-enter the last loop"}
          active={active}
          disabled={!hasLoop}
          onClick={() => void send({ type: active ? "loopExit" : "loopReenter", deck })}
        >
          {active ? "EXIT" : "RELOOP"}
        </Btn>
      </div>
    </div>
  );
}

function PitchControl({ deck, index, length }: { deck: DeckName; index: 0 | 1; length: number }): ReactNode {
  const pitch = useDeck(index, (d) => d.pitch, 0);
  const range = useDeck(index, (d) => d.pitchRange, 0.08);
  const keyLock = useDeck(index, (d) => d.keyLock, false);
  const keyShift = useDeck(index, (d) => d.keyShift, 0);
  const bend = (
    v: number,
  ): {
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
  } => ({
    onPointerDown: () => void send({ type: "bend", deck, bend: v }),
    onPointerUp: () => void send({ type: "bend", deck, bend: 0 }),
    onPointerLeave: () => void send({ type: "bend", deck, bend: 0 }),
  });
  return (
    <div className="flex flex-col items-center gap-1" role="group" aria-label={`Deck ${deck} pitch`}>
      <span className="text-[12px] font-semibold tabular-nums" aria-live="off">
        {pitch >= 0 ? "+" : "−"}
        {Math.abs(pitch * 100).toFixed(2)} %
      </span>
      <Fader
        label="PITCH"
        orientation="vertical"
        invert
        centreMark
        length={length}
        value={pitch}
        min={-range}
        max={range}
        defaultValue={0}
        steps={range * 1000}
        format={(v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)} %`}
        onChange={(v) => void send({ type: "pitch", deck, pitch: v })}
      />
      <div className="flex gap-0.5">
        {[0.08, 0.16, 0.5].map((r) => (
          <Btn key={r} title={`Pitch range ±${r * 100} %`} active={Math.abs(range - r) < 1e-6} onClick={() => void send({ type: "pitchRange", deck, range: r })}>
            {r * 100}
          </Btn>
        ))}
      </div>
      <div className="flex gap-0.5">
        <Btn title="Pitch bend down (hold)" {...bend(-0.04)}>
          −
        </Btn>
        <Btn title="Pitch bend up (hold)" {...bend(0.04)}>
          +
        </Btn>
        <Btn title="Reset pitch to 0 %" onClick={() => void send({ type: "pitch", deck, pitch: 0 })}>
          0
        </Btn>
      </div>
      <Btn wide title="Key lock: change tempo without changing the key" active={keyLock} onClick={() => void send({ type: "keyLock", deck, on: !keyLock })}>
        KEY LOCK
      </Btn>
      <div className="flex items-center gap-0.5">
        <Btn title="Key shift down one semitone" onClick={() => void send({ type: "keyShift", deck, semitones: keyShift - 1 })}>
          ♭
        </Btn>
        <button
          type="button"
          title="Key shift in semitones — click to reset"
          aria-label="Reset key shift"
          className="w-9 text-center text-[12px] tabular-nums"
          onClick={() => void send({ type: "keyShift", deck, semitones: 0 })}
        >
          {keyShift > 0 ? "+" : ""}
          {keyShift}
        </button>
        <Btn title="Key shift up one semitone" onClick={() => void send({ type: "keyShift", deck, semitones: keyShift + 1 })}>
          ♯
        </Btn>
      </div>
    </div>
  );
}

function Transport({ deck, index }: { deck: DeckName; index: 0 | 1 }): ReactNode {
  const loaded = useDeck(index, (d) => d.loaded, false);
  const playing = useDeck(index, (d) => d.playing, false);
  const k = KEYS[deck];
  return (
    <div className="flex gap-1" role="group" aria-label={`Deck ${deck} transport`}>
      <Btn
        wide
        title={`CUE (${k.cue}) — stopped: set cue here and play while held; playing: back to cue`}
        disabled={!loaded}
        onPointerDown={() => void send({ type: "cuePress", deck })}
        onPointerUp={() => void send({ type: "cueRelease", deck })}
        onPointerLeave={(e) => {
          if (e.buttons === 1) void send({ type: "cueRelease", deck });
        }}
      >
        CUE
      </Btn>
      <Btn wide title={`PAUSE (${k.play} toggles)`} disabled={!loaded} active={loaded && !playing} onClick={() => void send({ type: "pause", deck })}>
        ❚❚
      </Btn>
      <Btn wide title={`PLAY (${k.play} toggles)`} disabled={!loaded} active={playing} onClick={() => void send({ type: "play", deck })}>
        ▶
      </Btn>
      <Btn wide title={`CUP — jump to the cue point and play (${k.cup})`} disabled={!loaded} onClick={() => void send({ type: "cuePlay", deck })}>
        CUP
      </Btn>
      <Btn wide title={`SYNC — match the other deck's tempo (${k.sync})`} disabled={!loaded} onClick={() => void send({ type: "sync", deck }, "SYNC")}>
        SYNC
      </Btn>
    </div>
  );
}

// ----- info block with TAP -----

function useTap(index: 0 | 1): { taps: number; bpm: number | null; tap: () => void } {
  const times = useRef<number[]>([]);
  const [state, setState] = useState<{ taps: number; bpm: number | null }>({ taps: 0, bpm: null });
  const tap = (): void => {
    const now = performance.now();
    const t = times.current;
    if (t.length > 0 && now - (t[t.length - 1] ?? 0) > 2000) t.length = 0;
    t.push(now);
    if (t.length > 8) t.shift();
    if (t.length < 4) {
      setState({ taps: t.length, bpm: null });
      return;
    }
    const intervals = t.slice(1).map((v, i) => v - (t[i] ?? v));
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round((60_000 / avg) * 10) / 10;
    setState({ taps: t.length, bpm });
    const trackId = status.get()?.decks[index].trackId;
    if (trackId != null && bpm >= 20 && bpm < 400) {
      void backend()
        .setBpm([trackId], bpm)
        .then((r) => {
          if (run(r, "TAP") !== null) {
            notify("info", `BPM set to ${bpm} by TAP`);
            void refresh();
          }
        });
    }
  };
  return { ...state, tap };
}

function Info({ deck, index }: { deck: DeckName; index: 0 | 1 }): ReactNode {
  const bpm = useDeck(index, (d) => (d.bpm === null ? "—" : d.bpm.toFixed(1)), "—");
  const key = useDeck(index, (d) => d.key ?? "—", "—");
  const keyShift = useDeck(index, (d) => d.keyShift, 0);
  const total = useDeck(index, (d) => formatTime(d.duration), "");
  const trim = useStore(mixer, (m) => m[deck].trim);
  const loaded = useDeck(index, (d) => d.loaded, false);
  const remainRef = useLiveText<HTMLSpanElement>((s) => {
    const d = s?.decks[index];
    if (!d?.loaded || d.duration === null) return "—";
    return `−${formatTime(d.duration - livePosition(index))}`;
  });
  const { taps, bpm: tapBpm, tap } = useTap(index);
  const cell = (label: string, value: ReactNode, title: string): ReactNode => (
    <div className="flex flex-col" title={title}>
      <span className="text-[10px] font-semibold tracking-wide text-muted">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-6 items-end gap-2">
      {cell("BPM", bpm, "Tempo at the current pitch")}
      {cell("KEY", `${key}${keyShift !== 0 ? ` ${keyShift > 0 ? "+" : ""}${keyShift}` : ""}`, "Musical key (Camelot) and key shift")}
      {cell("GAIN", `${trim > 0 ? "+" : ""}${trim.toFixed(1)}`, "Channel gain (trim) in dB")}
      {cell("REMAIN", <span ref={remainRef} />, "Time left")}
      {cell("TOTAL", total || "—", "Track length")}
      <button
        type="button"
        disabled={!loaded}
        title="TAP — tap along with the beat (4+ taps) to set this track's BPM"
        aria-label="Tap tempo"
        className="h-9 rounded border border-border bg-surface-raised text-[11px] font-bold hover:bg-accent/20 disabled:opacity-40"
        onClick={tap}
      >
        TAP{taps > 0 && tapBpm === null ? ` ${taps}` : ""}
        {tapBpm !== null && <div className="text-[10px] font-normal">{tapBpm}</div>}
      </button>
    </div>
  );
}

function DeckState({ index }: { index: 0 | 1 }): ReactNode {
  const loaded = useDeck(index, (d) => d.loaded, false);
  const error = useDeck(index, (d) => d.decodeError, null);
  const live = useDeck(index, (d) => d.live, false);
  const radio = useDeck(index, (d) => d.radioState, null);
  const decoded = useDeck(index, (d) => Math.round(d.decoded * 100), 0);
  const wave = useDeck(index, (d) => d.waveform, "none");
  if (loaded && live) {
    if (error) {
      return (
        <p role="alert" className="truncate text-[11px] text-danger" title={error}>
          Radio: {error}
        </p>
      );
    }
    return (
      <p className="truncate text-[11px] text-muted" title={radio ?? ""}>
        <span className="mr-1 rounded bg-danger px-1 text-[10px] font-bold text-danger-text">LIVE</span>
        {radio === "playing" ? "receiving the station" : (radio ?? "")}
      </p>
    );
  }
  if (!loaded) return null;
  if (error) {
    return (
      <p role="alert" className="truncate text-[11px] text-danger">
        {error}
      </p>
    );
  }
  if (decoded < 100) return <p className="text-[11px] text-muted">Reading the file… {decoded} %</p>;
  if (wave === "computing") return <p className="text-[11px] text-muted">Drawing the waveform…</p>;
  return null;
}

export function Deck({ deck, large = false }: { deck: DeckName; large?: boolean }): ReactNode {
  const index = deck === "A" ? 0 : 1;
  const title = useDeck(index, (d) => d.title, "");
  const artist = useDeck(index, (d) => d.artist, "");
  const loaded = useDeck(index, (d) => d.loaded, false);
  const live = useDeck(index, (d) => d.live, false);
  const platter = large ? 200 : 140;
  return (
    <section
      aria-label={`Deck ${deck}`}
      data-drop="deck"
      data-drop-value={deck}
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-border bg-surface p-2 data-[drop-active=true]:border-accent data-[drop-active=true]:bg-accent/10"
    >
      <header className="flex items-baseline gap-2">
        <span className="text-[24px] font-black leading-none text-accent">{deck}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold" data-testid={`deck-${deck}-title`}>
            {loaded ? title || "Untitled" : "Drop a track here"}
          </div>
          <div className="truncate text-[12px] text-muted">{loaded ? artist : `Deck ${deck} is empty`}</div>
        </div>
      </header>
      <Info deck={deck} index={index} />
      <DeckState index={index} />
      <Overview deck={deck} index={index} />
      <div className={`flex gap-3 ${deck === "B" ? "flex-row-reverse" : ""}`}>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {live ? (
            <p className="rounded border border-border bg-bg p-2 text-[12px] text-muted">
              A radio station plays live: loops, hot cues, pitch and scratching do not apply.
            </p>
          ) : (
            <>
              <LoopPanel deck={deck} index={index} />
              <HotCuePads deck={deck} index={index} />
            </>
          )}
          <div className="flex justify-center">
            <Platter deck={deck} index={index} size={platter} />
          </div>
        </div>
        {!live && <PitchControl deck={deck} index={index} length={large ? 240 : 170} />}
      </div>
      <Transport deck={deck} index={index} />
    </section>
  );
}
