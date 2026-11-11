import { describe, expect, it } from "vitest";
import { shardOf, type DictShard } from "./dictFormat";
import { baseFormCandidates } from "./lemmatize";
import { createOfflineDict } from "./offline";

describe("baseFormCandidates", () => {
  it.each([
    ["running", "run"],
    ["peeped", "peep"],
    ["studies", "study"],
    ["considering", "consider"],
    ["bigger", "big"],
    ["happily", "happy"],
    ["churches", "church"],
    ["making", "make"],
    ["didn't", "did"],
    ["could", "can"],
  ])("%s → includes %s", (word, base) => {
    expect(baseFormCandidates(word)).toContain(base);
  });

  it("never returns the word itself or 1-letter stems", () => {
    expect(baseFormCandidates("is")).not.toContain("is");
    expect(baseFormCandidates("as").every((c) => c.length >= 2)).toBe(true);
  });
});

describe("offline dictionary", () => {
  const data: DictShard = {
    go: { t: [["verb", ["gitmek"]]], d: [["verb", "move", "go home"]] },
    went: { l: ["go"] },
    run: { t: [["verb", ["koşmak"]], ["noun", ["koşu"]]] },
    tired: { t: [["adjective", ["yorgun"]]] },
    zyx: { d: [["noun", "a made-up word"]] },
  };
  const loaded: string[] = [];
  const dict = createOfflineDict(async (name) => {
    loaded.push(name);
    return Object.fromEntries(Object.entries(data).filter(([w]) => shardOf(w) === name));
  });

  it("finds exact words", async () => {
    const r = await dict.lookup("tired");
    expect(r).toMatchObject({ translation: "yorgun", lemma: undefined, source: "offline" });
  });

  it("follows irregular forms", async () => {
    const r = await dict.lookup("went");
    expect(r).toMatchObject({ translation: "gitmek", lemma: "go" });
    expect(r?.definitions[0]).toEqual({ pos: "verb", gloss: "move", example: "go home" });
  });

  it("finds regular base forms", async () => {
    expect(await dict.lookup("running")).toMatchObject({ translation: "koşmak", lemma: "run" });
  });

  it("returns definition-only entries with an empty translation", async () => {
    expect(await dict.lookup("zyx")).toMatchObject({ translation: "", definitions: [{ gloss: "a made-up word" }] });
  });

  it("returns null for unknown words and loads each shard once", async () => {
    expect(await dict.lookup("qqqq")).toBeNull();
    expect(new Set(loaded).size).toBe(loaded.length);
  });
});
