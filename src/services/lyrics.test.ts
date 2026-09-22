import { describe, expect, it } from "vitest";
import { parseLrc } from "./lyrics";

describe("parseLrc", () => {
  it("parses mm:ss.xx timestamps", () => {
    const lines = parseLrc("[00:01.50]Hello\n[00:03.25]World");
    expect(lines).toEqual([
      { timeSeconds: 1.5, text: "Hello" },
      { timeSeconds: 3.25, text: "World" },
    ]);
  });

  it("parses mm:ss timestamps with no fractional part", () => {
    const lines = parseLrc("[01:00]One minute in");
    expect(lines).toEqual([{ timeSeconds: 60, text: "One minute in" }]);
  });

  it("drops lines with no timestamp", () => {
    const lines = parseLrc("[00:01.00]Real line\nNot a lyric line, no timestamp\n[ar:Some Artist]");
    expect(lines).toEqual([{ timeSeconds: 1, text: "Real line" }]);
  });

  it("emits one entry per timestamp when a line has multiple (walking-bass style repeats)", () => {
    const lines = parseLrc("[00:01.00][00:05.00]Same line twice");
    expect(lines).toEqual([
      { timeSeconds: 1, text: "Same line twice" },
      { timeSeconds: 5, text: "Same line twice" },
    ]);
  });

  it("sorts output by time even if the input wasn't ordered", () => {
    const lines = parseLrc("[00:10.00]Second\n[00:02.00]First");
    expect(lines.map((line) => line.text)).toEqual(["First", "Second"]);
  });

  it("returns an empty array for plain, unsynced text", () => {
    expect(parseLrc("Just a line\nAnother line")).toEqual([]);
  });
});
