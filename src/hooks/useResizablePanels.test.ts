import { describe, expect, it } from "vitest";
import { computeDraggedRatios } from "./useResizablePanels";

const START = { left: 0.2, center: 0.55, right: 0.25 };

describe("computeDraggedRatios", () => {
  it("dragging the left splitter right grows left and shrinks center; right stays fixed", () => {
    const result = computeDraggedRatios("left", START, 0.1, 0.1, 0.1);
    expect(result.left).toBeCloseTo(0.3, 6);
    expect(result.right).toBe(START.right);
    expect(result.center).toBeCloseTo(1 - 0.3 - 0.25, 6);
  });

  it("dragging the right splitter left grows right and shrinks center; left stays fixed", () => {
    const result = computeDraggedRatios("right", START, -0.1, 0.1, 0.1);
    expect(result.right).toBeCloseTo(0.35, 6);
    expect(result.left).toBe(START.left);
    expect(result.center).toBeCloseTo(1 - 0.2 - 0.35, 6);
  });

  it("clamps left to its minimum when dragged far past it", () => {
    const result = computeDraggedRatios("left", START, -0.5, 0.15, 0.1);
    expect(result.left).toBeCloseTo(0.15, 6);
  });

  it("clamps right to its minimum when dragged far past it", () => {
    const result = computeDraggedRatios("right", START, 0.5, 0.1, 0.2);
    expect(result.right).toBeCloseTo(0.2, 6);
  });

  it("never shrinks the center column below its minimum ratio", () => {
    const result = computeDraggedRatios("left", START, 0.9, 0.1, 0.1, 0.1);
    expect(result.center).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });

  it("left + center + right always sums to 1", () => {
    for (const delta of [-0.9, -0.3, 0, 0.15, 0.9]) {
      const left = computeDraggedRatios("left", START, delta, 0.1, 0.1);
      expect(left.left + left.center + left.right).toBeCloseTo(1, 9);
      const right = computeDraggedRatios("right", START, delta, 0.1, 0.1);
      expect(right.left + right.center + right.right).toBeCloseTo(1, 9);
    }
  });
});
