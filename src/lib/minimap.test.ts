import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMAP_HEIGHT_PX,
  MAX_TICK_PITCH,
  MINIMAP_PADDING_PX,
  MIN_TICK_PITCH,
  minimapLayout,
} from "./minimap";

describe("minimapLayout", () => {
  it("renders nothing for an empty session", () => {
    expect(minimapLayout(0)).toEqual({ pitch: MAX_TICK_PITCH, indices: [] });
  });

  it("uses the maximum pitch for a single question", () => {
    const layout = minimapLayout(1);
    expect(layout.pitch).toBe(MAX_TICK_PITCH);
    expect(layout.indices).toEqual([0]);
  });

  it("keeps small sessions at the maximum pitch instead of spreading them out", () => {
    // A handful of questions must stay a tight block, which is the whole point
    // of the rail: the old implementation stretched them over the full height.
    for (const count of [2, 3, 5, 10]) {
      const layout = minimapLayout(count);
      expect(layout.pitch).toBe(MAX_TICK_PITCH);
      expect(layout.indices).toHaveLength(count);
    }
  });

  it("renders every question while they fit at the minimum pitch", () => {
    const count = 50;
    const layout = minimapLayout(count, DEFAULT_MINIMAP_HEIGHT_PX);
    expect(layout.indices).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(layout.pitch).toBeGreaterThanOrEqual(MIN_TICK_PITCH);
  });

  it("tightens the pitch so the block fits the available height", () => {
    const height = 320;
    const count = 40;
    const layout = minimapLayout(count, height);
    expect(layout.pitch).toBeLessThan(MAX_TICK_PITCH);
    expect(layout.pitch * layout.indices.length).toBeLessThanOrEqual(height - MINIMAP_PADDING_PX);
  });

  it("samples ticks instead of collapsing into a solid bar on huge sessions", () => {
    // At the minimum pitch the 2px-tall bars keep a visible gap; rendering all
    // 5000 questions would merge them into one unreadable smear.
    const layout = minimapLayout(5000, DEFAULT_MINIMAP_HEIGHT_PX);
    expect(layout.pitch).toBe(MIN_TICK_PITCH);
    expect(layout.indices.length).toBeLessThan(5000);
    expect(layout.indices.length).toBeGreaterThan(10);
  });

  it("spans the whole session when sampling", () => {
    const count = 5000;
    const layout = minimapLayout(count, DEFAULT_MINIMAP_HEIGHT_PX);
    expect(layout.indices[0]).toBe(0);
    expect(layout.indices.at(-1)).toBe(count - 1);
  });

  it("keeps sampled indices strictly ascending and unique", () => {
    const layout = minimapLayout(3000, DEFAULT_MINIMAP_HEIGHT_PX);
    for (let i = 1; i < layout.indices.length; i += 1) {
      expect(layout.indices[i]).toBeGreaterThan(layout.indices[i - 1]);
    }
  });

  it("always keeps the active question visible", () => {
    const count = 5000;
    // Pick an index that the even sampling would skip.
    const active = 1234;
    const sampled = minimapLayout(count, DEFAULT_MINIMAP_HEIGHT_PX);
    expect(sampled.indices).not.toContain(active);

    const layout = minimapLayout(count, DEFAULT_MINIMAP_HEIGHT_PX, active);
    expect(layout.indices).toContain(active);
    for (let i = 1; i < layout.indices.length; i += 1) {
      expect(layout.indices[i]).toBeGreaterThan(layout.indices[i - 1]);
    }
  });

  it("ignores an out-of-range active index", () => {
    const layout = minimapLayout(5000, DEFAULT_MINIMAP_HEIGHT_PX, 999_999);
    expect(layout.indices.every((i) => i >= 0 && i < 5000)).toBe(true);
    expect(minimapLayout(5, DEFAULT_MINIMAP_HEIGHT_PX, -1).indices).toHaveLength(5);
  });

  it("falls back to the minimum pitch for a non-positive height", () => {
    expect(minimapLayout(50, 0).pitch).toBe(MIN_TICK_PITCH);
    expect(minimapLayout(50, MINIMAP_PADDING_PX).pitch).toBe(MIN_TICK_PITCH);
  });

  it("never exceeds the rail budget as the question count grows", () => {
    const usable = DEFAULT_MINIMAP_HEIGHT_PX - MINIMAP_PADDING_PX;
    const counts = [1, 2, 5, 10, 30, 60, 100, 300, 1000, 5000];
    for (const count of counts) {
      const l = minimapLayout(count, DEFAULT_MINIMAP_HEIGHT_PX);
      const used = l.pitch * l.indices.length;
      expect(used).toBeLessThanOrEqual(usable);
      // Short sessions stay compact; long ones are bounded by the rail height.
      expect(used).toBeLessThanOrEqual(Math.min(count * MAX_TICK_PITCH, usable));
    }
  });

  it("uses more of the rail when more height is available", () => {
    const tall = minimapLayout(60, 800);
    const short = minimapLayout(60, 300);
    expect(tall.indices.length).toBeGreaterThanOrEqual(short.indices.length);
  });
});
