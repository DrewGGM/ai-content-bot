import { describe, it, expect } from "vitest";
import { withUsage, track, hasCost } from "../src/lib/usage.js";

describe("usage / costo por pieza", () => {
  it("acumula el gasto de los providers dentro de withUsage", async () => {
    const { usage } = await withUsage(async () => {
      track("image");           // 0.04
      track("image");           // 0.04
      track("video");           // 0.40
      track("tts", 1000);       // 0.0003 * 1000 = 0.30
    });
    expect(usage.byProvider.image.calls).toBe(2);
    expect(usage.byProvider.image.usd).toBeCloseTo(0.08, 5);
    expect(usage.byProvider.video.usd).toBeCloseTo(0.40, 5);
    expect(usage.byProvider.tts.usd).toBeCloseTo(0.30, 5);
    expect(usage.usd).toBeCloseTo(0.78, 5);
    expect(usage.estimated).toBe(true);
    expect(hasCost(usage)).toBe(true);
  });

  it("el copy (llm) cuenta llamadas pero cuesta 0 (suscripción)", async () => {
    const { usage } = await withUsage(async () => { track("llm"); track("llm"); });
    expect(usage.byProvider.llm.calls).toBe(2);
    expect(usage.usd).toBe(0);
  });

  it("track fuera de withUsage es no-op (no rompe en jobs sueltos)", () => {
    expect(() => track("image")).not.toThrow();
  });

  it("hasCost es false cuando no hubo gasto", async () => {
    const { usage } = await withUsage(async () => { /* nada */ });
    expect(hasCost(usage)).toBe(false);
  });

  it("cada withUsage tiene su propio acumulador aislado", async () => {
    const a = await withUsage(async () => { track("image"); });
    const b = await withUsage(async () => { track("video"); });
    expect(a.usage.byProvider.image).toBeDefined();
    expect(a.usage.byProvider.video).toBeUndefined();
    expect(b.usage.byProvider.video).toBeDefined();
    expect(b.usage.byProvider.image).toBeUndefined();
  });
});
