import { describe, expect, it, vi } from "vitest";
import { allowTrackDrop, beginTrackDrag, readTrackDrop } from "./dragAndDrop";

// A minimal DataTransfer stand-in — vitest's Node environment has no real
// DragEvent/DataTransfer, but these functions only touch the few members
// used below, so a plain object satisfies them at the type level.
function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    effectAllowed: "none",
    dropEffect: "none",
    get types() {
      return Array.from(store.keys());
    },
    setData: vi.fn((type: string, value: string) => store.set(type, value)),
    getData: vi.fn((type: string) => store.get(type) ?? ""),
  };
}

function fakeDragEvent(dataTransfer: ReturnType<typeof fakeDataTransfer> | null) {
  return { dataTransfer, preventDefault: vi.fn() } as unknown as DragEvent;
}

describe("beginTrackDrag / readTrackDrop", () => {
  it("round-trips a track payload through the internal drag protocol", () => {
    const dataTransfer = fakeDataTransfer();
    const dragEvent = fakeDragEvent(dataTransfer);

    beginTrackDrag(dragEvent, { filePath: "C:/Music/a.mp3", fileName: "a.mp3" });
    expect(dataTransfer.effectAllowed).toBe("copy");

    const dropEvent = fakeDragEvent(dataTransfer);
    const payload = readTrackDrop(dropEvent);

    expect(payload).toEqual({ filePath: "C:/Music/a.mp3", fileName: "a.mp3" });
    expect(dropEvent.preventDefault).toHaveBeenCalled();
  });

  it("readTrackDrop returns null and does not preventDefault for a non-track drag", () => {
    const dropEvent = fakeDragEvent(fakeDataTransfer());
    expect(readTrackDrop(dropEvent)).toBeNull();
    expect(dropEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("readTrackDrop returns null for malformed JSON without throwing", () => {
    const dataTransfer = fakeDataTransfer({ "application/x-bongplayer-track": "{not json" });
    expect(readTrackDrop(fakeDragEvent(dataTransfer))).toBeNull();
  });

  it("readTrackDrop returns null for well-formed JSON that isn't a track payload", () => {
    const dataTransfer = fakeDataTransfer({
      "application/x-bongplayer-track": JSON.stringify({ foo: 1 }),
    });
    expect(readTrackDrop(fakeDragEvent(dataTransfer))).toBeNull();
  });
});

describe("allowTrackDrop", () => {
  it("preventDefaults and sets dropEffect only when the drag carries a track payload", () => {
    const dataTransfer = fakeDataTransfer({ "application/x-bongplayer-track": "{}" });
    const event = fakeDragEvent(dataTransfer);

    allowTrackDrop(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("does nothing for a drag with no track payload", () => {
    const event = fakeDragEvent(fakeDataTransfer());
    allowTrackDrop(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
