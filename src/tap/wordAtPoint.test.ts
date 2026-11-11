import { describe, expect, it } from "vitest";
import { flattenText, joinHyphenated, sentenceAround, wordAt } from "./wordAtPoint";

const at = (text: string, needle: string, delta = 0) => text.indexOf(needle) + delta;
const wordIn = (text: string, i: number) => {
  const b = wordAt(text, i);
  return b && text.slice(b.start, b.end);
};

describe("wordAt", () => {
  const text = "She didn’t know the well-known teacher's name, did she?";

  it("finds the word at any letter", () => {
    expect(wordIn(text, at(text, "know"))).toBe("know");
    expect(wordIn(text, at(text, "know", 3))).toBe("know");
  });

  it("keeps contractions and possessives whole", () => {
    expect(wordIn(text, at(text, "didn"))).toBe("didn’t");
    expect(wordIn(text, at(text, "teacher"))).toBe("teacher's");
  });

  it("splits hyphenated compounds into parts", () => {
    expect(wordIn(text, at(text, "well"))).toBe("well");
    expect(wordIn(text, at(text, "known"))).toBe("known");
  });

  it("returns null on spaces, punctuation and numbers", () => {
    expect(wordAt(text, at(text, " the"))).toBeNull();
    expect(wordAt(text, at(text, ","))).toBeNull();
    expect(wordAt("page 42 here", 6)).toBeNull();
  });
});

describe("joinHyphenated", () => {
  const text = "a lot of infor-\nmation here";

  it("joins a word split over two lines, from either half", () => {
    const first = wordAt(text, at(text, "infor"))!;
    const joined = joinHyphenated(text, first.start, first.end);
    expect(text.slice(joined.start, joined.end)).toBe("infor-\nmation");

    const second = wordAt(text, at(text, "mation"))!;
    const joined2 = joinHyphenated(text, second.start, second.end);
    expect(text.slice(joined2.start, joined2.end)).toBe("infor-\nmation");
  });

  it("joins all-caps comic lettering split over two lines", () => {
    const caps = "FOR BEINGS LIKE US, OVER-\nCOMING FEAR";
    const b = wordAt(caps, at(caps, "COMING"))!;
    const joined = joinHyphenated(caps, b.start, b.end);
    expect(caps.slice(joined.start, joined.end)).toBe("OVER-\nCOMING");
  });

  it("leaves normal words alone", () => {
    const b = wordAt(text, at(text, "lot"))!;
    expect(joinHyphenated(text, b.start, b.end)).toEqual(b);
  });
});

describe("sentenceAround", () => {
  it("returns only the sentence containing the word, joined across lines", () => {
    const text = "First one. The quick brown\nfox jumps over the lazy dog. Last one.";
    const i = at(text, "fox");
    expect(sentenceAround(text, i, i + 3)).toBe("The quick brown fox jumps over the lazy dog.");
  });

  it("removes end-of-line hyphens", () => {
    const text = "We need more infor-\nmation today.";
    const i = at(text, "today");
    expect(sentenceAround(text, i, i + 5)).toBe("We need more information today.");
  });
});

describe("flattenText", () => {
  it("adds a line break at <br> so lines don't glue together", () => {
    const div = document.createElement("div");
    div.innerHTML = "<span>end of line</span><br><span>next line</span>";
    expect(flattenText(div).text).toBe("end of line\nnext line");
  });
});
