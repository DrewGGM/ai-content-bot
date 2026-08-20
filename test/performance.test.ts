import { describe, it, expect } from "vitest";
import { scoreOf } from "../src/lib/performance.js";

describe("performance / score de engagement", () => {
  it("pondera guardados y compartidos por encima de likes", () => {
    // saved*3 + shares*3 + comments*2 + likes*1
    expect(scoreOf({ saved: 1 })).toBe(3);
    expect(scoreOf({ shares: 1 })).toBe(3);
    expect(scoreOf({ comments: 1 })).toBe(2);
    expect(scoreOf({ likes: 1 })).toBe(1);
  });

  it("un guardado vale más que muchos likes (intención real)", () => {
    expect(scoreOf({ saved: 1 })).toBeGreaterThan(scoreOf({ likes: 2 }));
  });

  it("acepta el alias saves == saved", () => {
    expect(scoreOf({ saves: 2 })).toBe(6);
    expect(scoreOf({ saves: 2 })).toBe(scoreOf({ saved: 2 }));
  });

  it("suma todas las señales", () => {
    expect(scoreOf({ saved: 2, shares: 1, comments: 3, likes: 10 })).toBe(2 * 3 + 1 * 3 + 3 * 2 + 10);
  });

  it("sin métricas el score es 0", () => {
    expect(scoreOf({})).toBe(0);
    expect(scoreOf({ reach: 5000 })).toBe(0); // el alcance no infla el score por sí solo
  });
});
