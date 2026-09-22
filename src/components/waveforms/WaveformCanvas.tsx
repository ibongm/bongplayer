import { memo, useEffect, useRef } from "react";

export interface WaveformCanvasProps {
  readonly peaks: Float32Array;
  readonly playhead: number;
  readonly duration: number;
  readonly hotCues: readonly number[];
}

const WAVEFORM_COLOR = "rgb(56 189 248 / 0.85)";
const PLAYHEAD_COLOR = "rgb(241 245 249)";
const HOT_CUE_COLOR = "rgb(248 113 113)";
const HOT_CUE_WIDTH_PX = 2;
const PLAYHEAD_WIDTH_PX = 2;

/**
 * Waveform display: a static background canvas (redrawn only when the track
 * data changes) layered under an overlay canvas that redraws just the
 * playhead line every frame via requestAnimationFrame, decoupled from React's
 * render cycle — so 60 FPS playhead motion never re-renders the component or
 * re-paints the (potentially large) waveform bars.
 */
function WaveformCanvasComponent({ peaks, playhead, duration, hotCues }: WaveformCanvasProps) {
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef(playhead);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    drawWaveform(waveformCanvasRef.current, peaks, hotCues, duration);
  }, [peaks, hotCues, duration]);

  useEffect(() => {
    let frameId: number;
    const tick = () => {
      drawPlayhead(playheadCanvasRef.current, playheadRef.current, duration);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [duration]);

  return (
    <div className="relative h-full w-full">
      <canvas ref={waveformCanvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={playheadCanvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

function resizeToDisplaySize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

function drawWaveform(
  canvas: HTMLCanvasElement | null,
  peaks: Float32Array,
  hotCues: readonly number[],
  duration: number,
): void {
  if (canvas === null) return;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const { width, height } = resizeToDisplaySize(canvas);
  ctx.clearRect(0, 0, width, height);

  const pixelCount = peaks.length / 2;
  if (pixelCount === 0) return;
  const midY = height / 2;
  const barWidth = Math.max(1, width / pixelCount);

  ctx.fillStyle = WAVEFORM_COLOR;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const min = peaks[pixel * 2];
    const max = peaks[pixel * 2 + 1];
    const x = (pixel / pixelCount) * width;
    const yTop = midY - max * midY;
    const yBottom = midY - min * midY;
    ctx.fillRect(x, yTop, barWidth, Math.max(1, yBottom - yTop));
  }

  if (duration > 0) {
    ctx.fillStyle = HOT_CUE_COLOR;
    for (const cueSeconds of hotCues) {
      const x = (cueSeconds / duration) * width;
      ctx.fillRect(x, 0, HOT_CUE_WIDTH_PX, height);
    }
  }
}

function drawPlayhead(
  canvas: HTMLCanvasElement | null,
  playheadSeconds: number,
  duration: number,
): void {
  if (canvas === null) return;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const { width, height } = resizeToDisplaySize(canvas);
  ctx.clearRect(0, 0, width, height);
  if (duration <= 0) return;

  const x = (playheadSeconds / duration) * width;
  ctx.strokeStyle = PLAYHEAD_COLOR;
  ctx.lineWidth = PLAYHEAD_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
}

export const WaveformCanvas = memo(WaveformCanvasComponent);
