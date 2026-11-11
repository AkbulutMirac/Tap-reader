/**
 * Turn a word as written ("Children’s", "RUNNING,") into a dictionary key ("children", "running").
 */
export function normalizeWord(raw: string): string {
  let w = raw
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[­​-‍]/g, "")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  // Possessives: "teacher's" → "teacher", "teachers'" → "teachers".
  w = w.replace(/'s$/i, "").replace(/s'$/i, "s");
  return w.toLowerCase();
}
