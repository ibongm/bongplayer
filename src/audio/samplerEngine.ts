/**
 * Sampler slot playback: a buffer cache (SamplerSlot in useSamplerStore only
 * holds a filePath, not the decoded audio) plus choke-group-aware
 * triggering through the shared samplerBus (Phase 2).
 */

import { getAudioContext } from "./context";
import { getMasterGraph } from "./masterGraph";
import type { SlotIndex } from "../types/deck";
import type { ChokeGroup, SamplerSlot } from "../store/useSamplerStore";

const buffers = new Map<SlotIndex, AudioBuffer>();
const activeSources = new Map<SlotIndex, AudioBufferSourceNode>();

export function setSamplerBuffer(index: SlotIndex, buffer: AudioBuffer): void {
  buffers.set(index, buffer);
}

function stopSamplerVoice(index: SlotIndex): void {
  const node = activeSources.get(index);
  if (node === undefined) return;
  node.onended = null;
  try {
    node.stop();
  } catch {
    // Already stopped — fine to ignore.
  }
  node.disconnect();
  activeSources.delete(index);
}

export function clearSamplerBuffer(index: SlotIndex): void {
  buffers.delete(index);
  stopSamplerVoice(index);
}

/**
 * Triggers a sample slot. `allSlots` is used purely to resolve which other
 * slots share this one's (nonzero) choke group and stop them first.
 */
export function triggerSamplerSlot(index: SlotIndex, allSlots: readonly SamplerSlot[]): void {
  const buffer = buffers.get(index);
  if (buffer === undefined) return;

  const chokeGroup: ChokeGroup = allSlots.find((slot) => slot.index === index)?.chokeGroup ?? 0;
  if (chokeGroup !== 0) {
    for (const slot of allSlots) {
      if (slot.index !== index && slot.chokeGroup === chokeGroup) {
        stopSamplerVoice(slot.index);
      }
    }
  }

  stopSamplerVoice(index); // retriggering the same pad cuts its previous instance.

  const context = getAudioContext();
  const voice = getMasterGraph().samplerBus.voices[index - 1];
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(voice.input);
  node.onended = () => {
    if (activeSources.get(index) === node) {
      activeSources.delete(index);
    }
  };
  node.start();
  activeSources.set(index, node);
}
