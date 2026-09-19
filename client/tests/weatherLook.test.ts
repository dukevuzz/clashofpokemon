import { describe, it, expect } from "vitest";
import { LOOK, caption } from "../src/ui/weatherLook";
import { ALL_WEATHER, WEATHER_SWING } from "../src/core/weather";

describe("what each sky looks like", () => {
  it("has a look for every weather the rules can produce", () => {
    for (const w of ALL_WEATHER) expect(LOOK[w], `${w} has no look`).toBeDefined();
  });

  it("never tints the board so hard it stops being readable", () => {
    // The mock this follows is "tint plus particles, nothing else". A wash
    // past 0.4 starts hiding which creature is which, and the fight matters
    // more than the weather drawn over it.
    for (const w of ALL_WEATHER) {
      expect(LOOK[w].alpha).toBeGreaterThan(0);
      expect(LOOK[w].alpha).toBeLessThanOrEqual(0.4);
    }
  });

  it("draws night as a tint and nothing else", () => {
    expect(LOOK.NIGHT.particle).toBeUndefined();
  });

  it("gives the falling weathers something that falls", () => {
    for (const w of ["RAIN", "SNOW", "STORM"] as const) {
      const p = LOOK[w].particle!;
      expect(p, `${w} has no particles`).toBeDefined();
      expect(p.speedY[0]).toBeGreaterThan(0);
    }
  });
});

describe("the caption a player reads", () => {
  it("names the sky and both types it moves", () => {
    const c = caption("RAIN");
    expect(c).toMatch(/Rain/);
    expect(c).toMatch(/Water \+/);
    expect(c).toMatch(/Fire −/);
  });

  it("reads its numbers off the rule rather than restating them", () => {
    // The damp is the reciprocal of the boost, so +20% up is -17% down, not
    // -20%. Hand-writing "20%" twice is exactly how that went wrong once in
    // conversation; the caption computes both.
    const up = Math.round((WEATHER_SWING - 1) * 100);
    const down = Math.round((1 - 1 / WEATHER_SWING) * 100);
    const c = caption("DROUGHT");
    expect(c).toContain(`Fire +${up}%`);
    expect(c).toContain(`Water −${down}%`);
    expect(up).not.toBe(down);
  });

  it("says nothing for a clear sky", () => {
    expect(caption(null)).toBe("");
  });
});
