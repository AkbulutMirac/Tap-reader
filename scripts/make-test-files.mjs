// Generates one small test file per supported format into test-files/ (git-ignored):
// EPUB, DOCX, TXT, Markdown, HTML, RTF, a scanned (image-only) PDF and a CBZ comic.
// Images are drawn in headless Edge so OCR can be tested on real rendered text.
// Run: node scripts/make-test-files.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const out = fileURLToPath(new URL("../test-files/", import.meta.url));
mkdirSync(out, { recursive: true });

const PARAS = [
  "The old lighthouse keeper climbed the narrow stairs every evening, carrying a lantern and a small notebook.",
  "He wrote down the weather, the ships that passed, and anything unusual he noticed on the horizon.",
  "One stormy night he saw a faint light flickering far beyond the reef, where no vessel should have been.",
];

// ---- tiny ZIP writer (stored, no compression) ----------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(body.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

// ---- text formats ----------------------------------------------------------------------------
writeFileSync(out + "story.txt", `CHAPTER ONE\n\n${PARAS.join("\n\n")}\n`);
writeFileSync(out + "story.md", `# The Lighthouse\n\n## Chapter one\n\n${PARAS.join("\n\n")}\n`);
writeFileSync(out + "story.html", `<!doctype html><html><head><title>The Lighthouse</title><script>alert(1)</script></head><body><h1>The Lighthouse</h1>${PARAS.map((p) => `<p>${p}</p>`).join("")}</body></html>`);
writeFileSync(out + "story.rtf", `{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}\\f0 ${PARAS.join("\\par\n")}\\par}`);

// EPUB 3
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;
writeFileSync(
  out + "story.epub",
  zip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
    ["OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">tapreader-test</dc:identifier><dc:title>The Lighthouse Keeper</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`],
    ["OEBPS/nav.xhtml", xhtml("Contents", `<nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter One</a></li><li><a href="c2.xhtml">Chapter Two</a></li></ol></nav>`)],
    ["OEBPS/c1.xhtml", xhtml("Chapter One", `<h1>Chapter One</h1>${PARAS.map((p) => `<p>${p}</p>`).join("")}`)],
    ["OEBPS/c2.xhtml", xhtml("Chapter Two", `<h1>Chapter Two</h1><script>top.__epubScriptRan = true</script><p>The next morning the sea was calm and the mysterious light had vanished.</p>`)],
  ]),
);

// DOCX
const w = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
writeFileSync(
  out + "story.docx",
  zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${PARAS.map(w).join("")}</w:body></w:document>`],
  ]),
);

// ---- images drawn in Edge (scanned page + comic) ---------------------------------------------
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const draw = (fn, arg) => page.evaluate(fn, arg).then((b64) => Buffer.from(b64, "base64"));

// A "scanned" book page: dark text on slightly gray paper, as JPEG.
const scan = await draw((paras) => {
  const c = document.createElement("canvas");
  c.width = 1240;
  c.height = 1754;
  const g = c.getContext("2d");
  g.fillStyle = "#f2f0ea";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#222";
  g.font = "34px Georgia";
  let y = 200;
  for (const p of paras) {
    let line = "";
    for (const word of p.split(" ")) {
      if (g.measureText(line + word).width > 1000) {
        g.fillText(line.trim(), 120, y);
        y += 52;
        line = "";
      }
      line += word + " ";
    }
    g.fillText(line.trim(), 120, y);
    y += 90;
  }
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, PARAS);

/** Image-only PDF: one page showing the JPEG (like a scanned page or a comic exported as PDF). */
function imagePdf(jpeg, imgW, imgH) {
  const W = 595;
  const H = Math.round((W * imgH) / imgW);
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    null, // image
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [];
  let size = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(size);
    const buf =
      o ??
      Buffer.concat([
        Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
        jpeg,
        Buffer.from("\nendstream\nendobj\n"),
      ]);
    const chunk = o ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`) : buf;
    parts.push(chunk);
    size += chunk.length;
  });
  const xref = size;
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) tail += `${String(off).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}
writeFileSync(out + "scanned.pdf", imagePdf(scan, 1240, 1754));

// Comic pages: art-ish background with white speech bubbles in a comic-style capital font.
const comicPage = (bubbles, type = "image/png", quality = 0.92) =>
  draw(({ bubbles, type, quality }) => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 1400;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 1000, 1400);
    grad.addColorStop(0, "#7aa6d6");
    grad.addColorStop(1, "#c98b5b");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1000, 1400);
    g.fillStyle = "#3b2a1a";
    for (let i = 0; i < 25; i++) g.fillRect((i * 137) % 1000, 700 + ((i * 89) % 600), 60, 120);
    for (const b of bubbles) {
      g.fillStyle = "#fff";
      g.strokeStyle = "#111";
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = "#111";
      g.font = "bold 34px 'Comic Sans MS', 'Segoe Print', sans-serif";
      g.textAlign = "center";
      b.lines.forEach((l, i) => g.fillText(l, b.x, b.y - ((b.lines.length - 1) * 42) / 2 + i * 42 + 12));
    }
    return c.toDataURL(type, quality).split(",")[1];
  }, { bubbles, type, quality });

const PAGE1 = [
  { x: 330, y: 220, rx: 270, ry: 150, lines: ["WHERE IS THE", "TREASURE HIDDEN?"] },
  { x: 680, y: 560, rx: 260, ry: 130, lines: ["BEHIND THE", "ANCIENT WALL!"] },
];
const PAGE2 = [{ x: 500, y: 260, rx: 330, ry: 140, lines: ["WE MUST HURRY", "BEFORE SUNSET."] }];
const comic1 = await comicPage(PAGE1);
const comic2 = await comicPage(PAGE2);
writeFileSync(out + "comic.cbz", zip([["page01.png", comic1], ["page02.png", comic2]]));
writeFileSync(out + "comic-page.png", comic1);
// "Smaller" CBZ as download sites make them: WebP pages at lower quality.
writeFileSync(
  out + "comic-small.cbz",
  zip([
    ["page01.webp", await comicPage(PAGE1, "image/webp", 0.5)],
    ["page02.webp", await comicPage(PAGE2, "image/webp", 0.5)],
  ]),
);
// The same comic page exported as an image-only PDF.
writeFileSync(out + "comic.pdf", imagePdf(await comicPage(PAGE1, "image/jpeg", 0.85), 1000, 1400));

// A page laid out like a real comic: white margins and gutters, panels, rectangular caption
// boxes touching panel borders, speech bubbles. Word centers are saved for the tests.
{
  const result = await page.evaluate(() => {
    const W = 1000;
    const H = 1500;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    const panels = [
      [40, 40, 440, 760, "#3f7a3a", "#9fd36a"],
      [520, 40, 440, 360, "#28507a", "#7fb0d8"],
      [520, 440, 440, 360, "#2d4f63", "#88a9b8"],
      [40, 840, 920, 620, "#36586e", "#a3c4d6"],
    ];
    for (const [x, y, w, h, c1, c2] of panels) {
      const grad = g.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(20,20,20,0.55)";
      for (let i = 0; i < 6; i++) g.fillRect(x + ((i * 97) % (w - 60)), y + h - 60 - ((i * 53) % (h / 2)), 50, 50);
      g.strokeStyle = "#111";
      g.lineWidth = 6;
      g.strokeRect(x, y, w, h);
    }
    const targets = [];
    const text = (lines, x, y, lh, align, wanted) => {
      g.fillStyle = "#111";
      g.font = "bold 26px 'Comic Sans MS', 'Segoe Print', sans-serif";
      g.textAlign = align;
      lines.forEach((l, i) => {
        const by = y + i * lh;
        g.fillText(l, x, by);
        let left = align === "center" ? x - g.measureText(l).width / 2 : x;
        for (const word of l.split(" ")) {
          const ww = g.measureText(word).width;
          if (wanted.includes(word)) targets.push({ word, cx: (left + ww / 2) / W, cy: (by - 9) / H });
          left += ww + g.measureText(" ").width;
        }
      });
    };
    // Caption touching panel 2's top-left border.
    g.fillStyle = "#fdf6c8";
    g.fillRect(523, 43, 320, 118);
    g.strokeStyle = "#111";
    g.lineWidth = 3;
    g.strokeRect(523, 43, 320, 118);
    text(["I THOUGHT IT'D", "TAKE ME TO A BEACH", "HOUSE IN FLORIDA..."], 536, 80, 34, "left", ["THOUGHT", "BEACH"]);
    // Caption in panel 3's bottom-right corner.
    g.fillStyle = "#fdf6c8";
    g.fillRect(640, 700, 317, 97);
    g.strokeRect(640, 700, 317, 97);
    text(["INSTEAD I FOUND", "MYSELF FLYING HOME"], 652, 738, 34, "left", ["FLYING"]);
    // Speech bubbles in the big panel.
    for (const [bx, by, rx, ry, lines, wanted] of [
      [260, 980, 150, 60, ["JORDAN?"], ["JORDAN?"]],
      [700, 1100, 190, 85, ["WE HAVE PROTOCOLS", "TO FOLLOW!"], ["PROTOCOLS"]],
    ]) {
      g.fillStyle = "#fff";
      g.strokeStyle = "#111";
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      text(lines, bx, by + 10 - ((lines.length - 1) * 34) / 2, 34, "center", wanted);
    }
    return { png: c.toDataURL("image/png").split(",")[1], targets };
  });
  writeFileSync(out + "comic-captions.cbz", zip([["001.png", Buffer.from(result.png, "base64")]]));
  writeFileSync(out + "comic-captions.json", JSON.stringify(result.targets, null, 1));
}

await browser.close();
console.log(`test files written to ${out}`);
