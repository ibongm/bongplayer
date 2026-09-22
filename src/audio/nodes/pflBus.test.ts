import { describe, expect, it } from "vitest";
import { createPflBus, createSplitCableMerger, routeElementToOutputDevice } from "./pflBus";
import { connectTestOscillator, peakAmplitude, renderStereo } from "./testHelpers";
import { dbToGain } from "../utils";

describe("createPflBus", () => {
  it("has no mediaStreamDestination under OfflineAudioContext (spec: AudioContext-only)", async () => {
    const [samples] = await renderStereo(0.1, (context) => {
      const pfl = createPflBus(context);
      expect(pfl.mediaStreamDestination).toBeNull();
      connectTestOscillator(context, pfl.cueBus);
      pfl.cueBus.connect(context.destination);
    });
    expect(samples.length).toBeGreaterThan(0);
  });

  it("ramps cue level via setCueLevel", async () => {
    const [left] = await renderStereo(0.2, (context) => {
      const pfl = createPflBus(context);
      pfl.setCueLevel(-6, 0.01);
      connectTestOscillator(context, pfl.cueBus, 440, 0.2);
      pfl.cueBus.connect(context.destination);
    });

    const settled = peakAmplitude(left, Math.floor(0.05 * 44100), left.length);
    expect(settled).toBeCloseTo(dbToGain(-6), 2);
  });
});

describe("createSplitCableMerger", () => {
  it("routes the master bus to Left and the cue bus to Right", async () => {
    const [left, right] = await renderStereo(0.2, (context) => {
      const master = context.createGain();
      const cue = context.createGain();
      master.gain.value = 1;
      cue.gain.value = 1;

      const masterOsc = context.createOscillator();
      masterOsc.frequency.value = 300;
      masterOsc.connect(master);
      masterOsc.start(0);
      masterOsc.stop(0.2);

      // Cue bus stays silent (no oscillator connected) so Left/Right must
      // differ if routing is correct.
      const merger = createSplitCableMerger(context, master, cue);
      merger.connect(context.destination);
    });

    expect(peakAmplitude(left)).toBeGreaterThan(0.5);
    expect(peakAmplitude(right)).toBeCloseTo(0, 5);
  });
});

describe("routeElementToOutputDevice", () => {
  it("throws when the element doesn't support setSinkId", async () => {
    const fakeElement = {} as HTMLMediaElement;
    await expect(routeElementToOutputDevice(fakeElement, "device-1")).rejects.toThrow(
      /setSinkId is not supported/,
    );
  });

  it("delegates to the element's setSinkId when supported", async () => {
    let receivedDeviceId: string | null = null;
    const fakeElement = {
      setSinkId: async (deviceId: string) => {
        receivedDeviceId = deviceId;
      },
    } as unknown as HTMLMediaElement;

    await routeElementToOutputDevice(fakeElement, "device-42");
    expect(receivedDeviceId).toBe("device-42");
  });
});
