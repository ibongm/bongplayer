import { openAudioFileDialog } from "./dialog";
import { decodeTrack } from "./trackLoader";
import { setSamplerBuffer } from "../audio/samplerEngine";
import { useSamplerStore } from "../store/useSamplerStore";
import type { SlotIndex } from "../types/deck";

/** Opens the native file picker, decodes the chosen file, and loads it into the given sampler slot. */
export async function loadSamplerSlotViaDialog(index: SlotIndex): Promise<void> {
  const filePath = await openAudioFileDialog();
  if (filePath === null) return;

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const { metadata, audioBuffer } = await decodeTrack(filePath, fileName);

  setSamplerBuffer(index, audioBuffer);
  useSamplerStore.getState().loadSlot(index, filePath, metadata.title);
}
