// OCR accuracy benchmark on a real comic: for sample pages, find reference words with a
// full-page OCR pass, then run the app's tap OCR (ocrAtTap) at each word with different
// image-preparation settings and count how often the right word comes back.
// Usage: node scripts/ocr-bench.mjs <file.cbz> [baseUrl] [--pages 2,10,40]
import { chromium } from "playwright-core";

const file = process.argv[2];
const base = process.argv[3] ?? "http://localhost:5173";
const pagesArg = process.argv.indexOf("--pages");
const PAGES = pagesArg > 0 ? process.argv[pagesArg + 1].split(",").map(Number) : [2, 5, 10, 20, 31, 45, 58, 70, 84, 97, 110, 124];
const VARIANTS = {
  "gray 350px": { binarize: false, targetWidth: 350, maxUpscale: 1.5 },
  "gray 450px": { binarize: false, targetWidth: 450, maxUpscale: 2 },
  "gray 500px": { binarize: false, targetWidth: 500, maxUpscale: 2 },
  "binarized 500px": { binarize: true, targetWidth: 500, maxUpscale: 2 },
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 820, height: 1180 } })).newPage();
await page.goto(`${base}/#/`);
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(file);
await page.waitForURL(/#\/read\//, { timeout: 60000 });
await page.waitForFunction(() => document.querySelector(".comic-view img")?.complete, null, { timeout: 60000 });
const currentIndex = async () => Number(/(\d+) \/ \d+/.exec(await page.locator("footer").innerText())?.[1] ?? 0);

const score = Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, { ok: 0, n: 0, ms: 0 }]));
for (const n of PAGES) {
  while ((await currentIndex()) !== n) {
    await page.keyboard.press((await currentIndex()) < n ? "ArrowRight" : "ArrowLeft");
    await page.waitForTimeout(30);
  }
  await page.waitForFunction(() => document.querySelector(".comic-view img")?.complete);
  await page.waitForTimeout(200);
  const res = await page.evaluate(async (variants) => {
    const T = await import("/node_modules/tesseract.js/dist/tesseract.esm.min.js");
    const createWorker = T.createWorker ?? T.default.createWorker;
    window.__gt ??= await createWorker("eng", 1, {
      workerPath: `${location.origin}/vendor/tesseract/worker.min.js`,
      corePath: `${location.origin}/vendor/tesseract/core`,
      langPath: `${location.origin}/vendor/tesseract/lang`,
      gzip: true,
      workerBlobURL: false,
    });
    const img = document.querySelector(".comic-view img");
    const bmp = await createImageBitmap(img);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth * 2;
    c.height = img.naturalHeight * 2;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    await window.__gt.setParameters({ tessedit_pageseg_mode: "11" });
    const { data } = await window.__gt.recognize(c, {}, { blocks: true });
    const all = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    const good = all
      .filter((w) => w.confidence >= 88 && /^[A-Z][A-Z'’]{2,}[!?.,…-]*$/.test(w.text))
      .map((w) => ({ text: w.text.replace(/[^A-Z]/g, ""), cx: (w.bbox.x0 + w.bbox.x1) / 2 / c.width, cy: (w.bbox.y0 + w.bbox.y1) / 2 / c.height, h: (w.bbox.y1 - w.bbox.y0) / c.height }))
      .filter((w) => w.h > 0.004 && w.h < 0.03);
    const step = Math.max(1, Math.floor(good.length / 8));
    const targets = good.filter((_, i) => i % step === 0).slice(0, 8);

    const { ocrAtTap } = await import("/src/ocr/tapOcr.ts");
    const out = {};
    for (const [name, opts] of Object.entries(variants)) {
      out[name] = [];
      for (const t of targets) {
        const t0 = performance.now();
        const r = await ocrAtTap(bmp, t.cx, t.cy, [], false, opts);
        const ms = performance.now() - t0;
        let got = "";
        if (r.kind === "text" && r.word) {
          const w = r.added.reduce((a, b) => (Math.hypot(b.x + b.w / 2 - r.word.x, b.y + b.h / 2 - r.word.y) < Math.hypot(a.x + a.w / 2 - r.word.x, a.y + a.h / 2 - r.word.y) ? b : a));
          got = w.text;
        } else if (r.kind === "text" && r.block) got = `[block] ${r.block.text.slice(0, 30)}`;
        out[name].push({ want: t.text, got, ok: got.toUpperCase().replace(/[^A-Z]/g, "") === t.text, ms });
      }
    }
    return out;
  }, VARIANTS);
  let line = `p.${String(n).padStart(3)}`;
  for (const [name, rows] of Object.entries(res)) {
    const s = score[name];
    for (const r of rows) {
      s.n++;
      s.ok += r.ok ? 1 : 0;
      s.ms += r.ms;
    }
    line += ` | ${rows.filter((r) => r.ok).length}/${rows.length}`;
  }
  const misses = res["gray 500px"].filter((r) => !r.ok).map((r) => `${r.want}→${r.got || "∅"}`);
  console.log(`${line}   (gray 500 misses: ${misses.join(", ") || "none"})`);
}
console.log("\nvariant           correct        avg time");
for (const [name, s] of Object.entries(score)) {
  console.log(`${name.padEnd(17)} ${String(s.ok).padStart(3)}/${s.n} (${Math.round((100 * s.ok) / s.n)}%)   ${Math.round(s.ms / s.n)} ms`);
}
await browser.close();
