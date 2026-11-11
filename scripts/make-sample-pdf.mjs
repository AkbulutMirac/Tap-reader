// Writes public/samples/alice.pdf: the opening of "Alice's Adventures in Wonderland"
// (Lewis Carroll, 1865, public domain) as a plain text PDF for trying the app.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const paragraphs = [
  "CHAPTER I. Down the Rabbit-Hole",
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversations?'",
  "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
  "There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, 'Oh dear! Oh dear! I shall be late!' (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural); but when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.",
  "In another moment down went Alice after it, never once considering how in the world she was to get out again.",
  "The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.",
  "Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next. First, she tried to look down and make out what she was coming to, but it was too dark to see anything; then she looked at the sides of the well, and noticed that they were filled with cupboards and book-shelves; here and there she saw maps and pictures hung upon pegs.",
];

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const FONT_SIZE = 12;
const LEADING = 18;
const CHARS_PER_LINE = 78;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

function wrap(text) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > CHARS_PER_LINE) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const allLines = paragraphs.flatMap((p, i) => [...wrap(p), ...(i < paragraphs.length - 1 ? [""] : [])]);
const pages = [];
for (let i = 0; i < allLines.length; i += LINES_PER_PAGE) pages.push(allLines.slice(i, i + LINES_PER_PAGE));

const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
const objects = [];
const add = (body) => objects.push(body) && objects.length;

const catalog = add(null);
const pagesObj = add(null);
const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
const pageIds = pages.map((lines) => {
  const ops = [`BT /F1 ${FONT_SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN} Td`];
  for (const l of lines) ops.push(`(${esc(l)}) Tj T*`);
  ops.push("ET");
  const stream = ops.join("\n");
  const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  return add(
    `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
  );
});
objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

let out = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const dir = fileURLToPath(new URL("../public/samples/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "alice.pdf", out, "latin1");
console.log(`wrote ${dir}alice.pdf (${pages.length} pages)`);
