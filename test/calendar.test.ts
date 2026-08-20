import { describe, it, expect } from "vitest";
import { bestTimesFor, BEST_TIMES } from "../src/lib/calendar.js";

describe("calendar / mejores horarios", () => {
  it("cada red tiene al menos un horario en formato HH:MM", () => {
    for (const [net, times] of Object.entries(BEST_TIMES)) {
      expect(times.length, net).toBeGreaterThan(0);
      for (const t of times) expect(t).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("bestTimesFor devuelve los horarios de la plataforma", () => {
    expect(bestTimesFor("tiktok")).toEqual(BEST_TIMES.tiktok);
    expect(bestTimesFor("linkedin")).toEqual(BEST_TIMES.linkedin);
  });

  it("una plataforma desconocida cae a los horarios de Instagram", () => {
    expect(bestTimesFor("myspace")).toEqual(BEST_TIMES.instagram);
  });
});
