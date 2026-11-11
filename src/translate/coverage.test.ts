// How many of the most frequent English words the offline dictionary translates.
// Runs only when public/dict/ is built and data/en_50k.txt exists
// (FrequencyWords, OpenSubtitles 2018 — "word count" per line).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createOfflineDict } from "./offline";

const FREQ = "data/en_50k.txt";
const DICT = "public/dict/";
const ready = existsSync(FREQ) && existsSync(`${DICT}meta.json`);

describe.skipIf(!ready)("offline dictionary coverage", () => {
  const dict = createOfflineDict(async (name) => {
    const file = `${DICT}${name}.json`;
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  });
  const words = ready
    ? readFileSync(FREQ, "utf8")
        .split("\n")
        .map((l) => l.split(" ")[0])
        .filter((w) => /^[a-z]+$/.test(w) && w.length > 1)
    : [];

  it.each([1000, 5000, 20000])("top %i words", async (topN) => {
    let translated = 0;
    let uncertain = 0;
    let defsOnly = 0;
    const missing: string[] = [];
    for (const w of words.slice(0, topN)) {
      const r = await dict.lookup(w);
      if (r?.uncertain) uncertain++;
      if (r?.translation) translated++;
      else if (r) defsOnly++;
      else missing.push(w);
    }
    const pct = (n: number) => (100 * n) / topN;
    console.log(
      `top ${topN}: Turkish ${pct(translated).toFixed(1)}% (uncertain ${pct(uncertain).toFixed(1)}%), English-only ${pct(defsOnly).toFixed(1)}%, ` +
        `missing ${pct(missing.length).toFixed(1)}% — e.g. ${missing.slice(0, 30).join(" ")}`,
    );
    if (topN === 1000) expect(pct(translated)).toBeGreaterThan(85);
  });
});
