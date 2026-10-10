import { describe, expect, it } from "vitest";
import { clickRow, emptySelection, moveFocus, prune, selectAll, selectedInOrder } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const none = { ctrl: false, shift: false };

describe("selection rules", () => {
  it("click selects one row", () => {
    const s = clickRow(emptySelection, order, 2, none);
    expect([...s.keys]).toEqual(["c"]);
    expect(s.focus).toBe(2);
  });

  it("ctrl+click toggles rows", () => {
    let s = clickRow(emptySelection, order, 0, none);
    s = clickRow(s, order, 3, { ctrl: true, shift: false });
    expect(selectedInOrder(s, order)).toEqual(["a", "d"]);
    s = clickRow(s, order, 0, { ctrl: true, shift: false });
    expect(selectedInOrder(s, order)).toEqual(["d"]);
  });

  it("shift+click selects a range from the anchor, in both directions", () => {
    let s = clickRow(emptySelection, order, 1, none);
    s = clickRow(s, order, 3, { ctrl: false, shift: true });
    expect(selectedInOrder(s, order)).toEqual(["b", "c", "d"]);
    s = clickRow(s, order, 0, { ctrl: false, shift: true });
    expect(selectedInOrder(s, order)).toEqual(["a", "b"]);
  });

  it("ctrl+shift+click adds a range", () => {
    let s = clickRow(emptySelection, order, 0, none);
    s = clickRow(s, order, 3, { ctrl: true, shift: false });
    s = clickRow(s, order, 4, { ctrl: true, shift: true });
    expect(selectedInOrder(s, order)).toEqual(["a", "d", "e"]);
  });

  it("ctrl+A selects everything", () => {
    expect(selectAll(order).keys.size).toBe(5);
  });

  it("arrow keys move and shift+arrow extends", () => {
    let s = moveFocus(emptySelection, order, 1, false);
    expect(selectedInOrder(s, order)).toEqual(["a"]);
    s = moveFocus(s, order, 1, true);
    s = moveFocus(s, order, 1, true);
    expect(selectedInOrder(s, order)).toEqual(["a", "b", "c"]);
    s = moveFocus(s, order, 10, false);
    expect(selectedInOrder(s, order)).toEqual(["e"]);
  });

  it("pruning after a refresh keeps rows that still exist", () => {
    const s = selectAll(order);
    const p = prune(s, ["a", "c"]);
    expect(selectedInOrder(p, ["a", "c"])).toEqual(["a", "c"]);
    expect(p.focus).toBe(1);
  });
});
