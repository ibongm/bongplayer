import { DeckPanel } from "../deck/DeckPanel";
import { CenterMixer } from "../mixer/CenterMixer";
import { ChannelStrip } from "../mixer/ChannelStrip";
import { useMixerController } from "../../hooks/useMixerController";

/** Deck A | Deck B channel strip + mixer | Deck B, per ImplementationPlan.md §1's middle row. */
export function DeckMixerRow() {
  useMixerController();

  return (
    <div className="flex h-full w-full divide-x divide-white/10 overflow-hidden">
      <DeckPanel deck="a" />
      <div className="flex shrink-0">
        <ChannelStrip deck="a" />
        <CenterMixer />
        <ChannelStrip deck="b" />
      </div>
      <DeckPanel deck="b" />
    </div>
  );
}
