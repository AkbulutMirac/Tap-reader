import { describe, expect, it } from "vitest";
import type { OcrWord } from "../db";
import { floodLight, otsu } from "./bubble";
import { blocksOf, clusterAt } from "./tapOcr";

/** w×h gray image: 0 (dark) everywhere, `light` rects set to 255. */
function image(w: number, h: number, light: [x: number, y: number, rw: number, rh: number][]) {
  const g = new Float32Array(w * h);
  for (const [x0, y0, rw, rh] of light) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) g[y * w + x] = 255;
  return g;
}

describe("floodLight", () => {
  it("fills a light bubble surrounded by artwork", () => {
    const g = image(200, 200, [[60, 60, 40, 30]]);
    const mask = floodLight(g, 200, 200, 80, 75)!;
    expect(mask.reduce((s, v) => s + v, 0)).toBe(40 * 30);
  });

  it("rejects light regions that touch the page edge (margins, gutters)", () => {
    // A white margin strip along the left edge, 10% of the page.
    const g = image(200, 200, [[0, 0, 20, 200]]);
    expect(floodLight(g, 200, 200, 10, 100)).toBeNull();
  });

  it("rejects regions too big to be a bubble", () => {
    const g = image(200, 200, [[10, 10, 150, 150]]);
    expect(floodLight(g, 200, 200, 80, 80)).toBeNull();
  });

  it("finds the bubble when the tap lands inside a letter's hole (an O)", () => {
    const g = image(200, 200, [[50, 50, 80, 40]]);
    // A dark ring (the letter) with a small light hole at the tap point.
    for (let y = 62; y < 76; y++) for (let x = 82; x < 96; x++) g[y * 200 + x] = 0;
    for (let y = 66; y < 72; y++) for (let x = 86; x < 92; x++) g[y * 200 + x] = 255;
    const mask = floodLight(g, 200, 200, 88, 68)!;
    expect(mask).not.toBeNull();
    // The bubble (80×40 minus the 14×14 letter), not the 6×6 hole.
    expect(mask.reduce((s, v) => s + v, 0)).toBe(80 * 40 - 14 * 14);
  });

  it("starts from a nearby light pixel when the tap lands on a letter", () => {
    const g = image(200, 200, [[60, 60, 40, 30]]);
    g[75 * 200 + 80] = 0; // a dark "letter" pixel under the tap
    expect(floodLight(g, 200, 200, 80, 75)).not.toBeNull();
  });
});

describe("otsu", () => {
  it("splits a two-tone histogram between the tones", () => {
    const hist = new Array<number>(256).fill(0);
    hist[30] = 500;
    hist[220] = 500;
    const t = otsu(hist, 1000);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });
});

const word = (text: string, x: number, y: number, w = 0.06, h = 0.02, line = 0): OcrWord => ({ text, x, y, w, h, line, group: 0 });

describe("clusterAt", () => {
  // A two-line caption on the left, another bubble far to the right.
  const caption = [
    word("I", 0.1, 0.1, 0.01),
    word("THOUGHT", 0.115, 0.1),
    word("IT'D", 0.18, 0.1),
    word("TAKE", 0.1, 0.125, 0.05, 0.02, 1),
    word("ME", 0.155, 0.125, 0.03, 0.02, 1),
  ];
  const other = [word("JORDAN?", 0.7, 0.5)];

  it("returns the caption around the tapped word, not other text", () => {
    const got = clusterAt([...caption, ...other], 0.13, 0.11).map((w) => w.text);
    expect(got).toEqual(["I", "THOUGHT", "IT'D", "TAKE", "ME"]);
  });

  it("returns nothing when no word is near the tap", () => {
    expect(clusterAt([...caption, ...other], 0.45, 0.8)).toEqual([]);
  });

  it("blocksOf gives each group's box and text", () => {
    const [b] = blocksOf(caption);
    expect(b.text).toBe("I THOUGHT IT'D TAKE ME");
    expect(b.x).toBeCloseTo(0.1);
    expect(b.y + b.h).toBeCloseTo(0.145);
  });
});
