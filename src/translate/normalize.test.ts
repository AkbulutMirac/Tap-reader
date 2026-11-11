import { describe, expect, it } from "vitest";
import { normalizeWord } from "./normalize";

describe("normalizeWord", () => {
  it.each([
    ["Running,", "running"],
    ["“Hello”", "hello"],
    ["teacher’s", "teacher"],
    ["teachers'", "teachers"],
    ["didn’t", "didn't"],
    ["infor­mation", "information"],
    ["123", ""],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeWord(raw)).toBe(expected);
  });
});
