import { beforeEach, describe, expect, it } from "vitest";
import { useAutomixStore } from "./useAutomixStore";

beforeEach(() => {
  useAutomixStore.setState(useAutomixStore.getInitialState(), true);
});

describe("useAutomixStore", () => {
  it("enqueue assigns a unique id and appends to the end", () => {
    useAutomixStore.getState().enqueue({ filePath: "/a.mp3", fileName: "a.mp3" });
    useAutomixStore.getState().enqueue({ filePath: "/b.mp3", fileName: "b.mp3" });

    const queue = useAutomixStore.getState().queue;
    expect(queue).toHaveLength(2);
    expect(queue[0].fileName).toBe("a.mp3");
    expect(queue[1].fileName).toBe("b.mp3");
    expect(queue[0].id).not.toBe(queue[1].id);
  });

  it("removeFromQueue removes only the targeted entry", () => {
    useAutomixStore.getState().enqueue({ filePath: "/a.mp3", fileName: "a.mp3" });
    useAutomixStore.getState().enqueue({ filePath: "/b.mp3", fileName: "b.mp3" });
    const [first, second] = useAutomixStore.getState().queue;

    useAutomixStore.getState().removeFromQueue(first.id);

    expect(useAutomixStore.getState().queue).toEqual([second]);
  });

  it("moveToTop and moveToBottom reorder without duplicating or dropping entries", () => {
    useAutomixStore.getState().enqueue({ filePath: "/a.mp3", fileName: "a.mp3" });
    useAutomixStore.getState().enqueue({ filePath: "/b.mp3", fileName: "b.mp3" });
    useAutomixStore.getState().enqueue({ filePath: "/c.mp3", fileName: "c.mp3" });
    const [, , third] = useAutomixStore.getState().queue;

    useAutomixStore.getState().moveToTop(third.id);
    expect(useAutomixStore.getState().queue.map((entry) => entry.fileName)).toEqual([
      "c.mp3",
      "a.mp3",
      "b.mp3",
    ]);

    useAutomixStore.getState().moveToBottom(third.id);
    expect(useAutomixStore.getState().queue.map((entry) => entry.fileName)).toEqual([
      "a.mp3",
      "b.mp3",
      "c.mp3",
    ]);
  });

  it("clearQueue empties the queue", () => {
    useAutomixStore.getState().enqueue({ filePath: "/a.mp3", fileName: "a.mp3" });
    useAutomixStore.getState().clearQueue();
    expect(useAutomixStore.getState().queue).toHaveLength(0);
  });

  it("start/pause/stop drive the status; stop also clears the active deck", () => {
    useAutomixStore.getState().setActiveDeck("a");
    useAutomixStore.getState().start();
    expect(useAutomixStore.getState().status).toBe("running");

    useAutomixStore.getState().pause();
    expect(useAutomixStore.getState().status).toBe("paused");

    useAutomixStore.getState().stop();
    expect(useAutomixStore.getState().status).toBe("idle");
    expect(useAutomixStore.getState().activeDeck).toBeNull();
  });

  it("rejects negative transition/trigger durations", () => {
    useAutomixStore.getState().setTransitionSeconds(-5);
    expect(useAutomixStore.getState().transitionSeconds).toBe(0);
    useAutomixStore.getState().setTriggerThreshold(-5);
    expect(useAutomixStore.getState().triggerSecondsBeforeEnd).toBe(0);
  });
});
