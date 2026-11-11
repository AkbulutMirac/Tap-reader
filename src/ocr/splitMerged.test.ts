import { describe, expect, it } from "vitest";
import type { OcrWord } from "../db";
import { splitMerged } from "./splitMerged";

const DICT = new Set(["how", "much", "the", "sun", "getaway", "get", "away", "a", "lot", "young", "darkness", "park", "ness", "carol", "abrin", "dais"]);
const known = async (w: string) => DICT.has(w);
const word = (text: string, conf = 70): OcrWord => ({ text, x: 0.1, y: 0.1, w: 0.2, h: 0.02, line: 0, group: 0, conf });

describe("splitMerged", () => {
  it("splits two glued words", async () => {
    const out = await splitMerged([word("HOWMUCH")], known);
    expect(out.map((w) => w.text)).toEqual(["HOW", "MUCH"]);
    expect(out[1].x).toBeGreaterThan(out[0].x + out[0].w);
  });

  it("keeps punctuation on the outside halves", async () => {
    expect((await splitMerged([word("THESUN.")], known)).map((w) => w.text)).toEqual(["THE", "SUN."]);
  });

  it("fixes one-letter OCR slips in unsure words", async () => {
    const out = await splitMerged([word("YONG"), word("PARKNESS"), word("CAROOL?")], known);
    expect(out.map((w) => w.text)).toEqual(["YOUNG", "DARKNESS", "CAROL?"]);
  });

  it("leaves confidently read unknown words (names) alone", async () => {
    expect((await splitMerged([word("ABIN", 96)], known)).map((w) => w.text)).toEqual(["ABIN"]);
  });

  it("only drops doubled letters, so names aren't turned into other words", async () => {
    // DAVIS → DAIS would need dropping a single V.
    expect((await splitMerged([word("DAVIS")], known)).map((w) => w.text)).toEqual(["DAVIS"]);
  });

  it("splits when one glued half has a look-alike slip", async () => {
    expect((await splitMerged([word("THESWN.")], known)).map((w) => w.text)).toEqual(["THE", "SUN."]);
  });

  it("leaves real words and unknown words alone", async () => {
    expect((await splitMerged([word("GETAWAY"), word("XQZVRT"), word("SUN")], known)).map((w) => w.text)).toEqual([
      "GETAWAY",
      "XQZVRT",
      "SUN",
    ]);
  });
});
