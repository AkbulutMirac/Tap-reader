// Tablet test with a real comic (CBZ): tap many lettered words and check the popup shows the
// same word; also opening time, swipe page turns, resume, pinch zoom and landscape.
// Words to tap are found by a separate full-page OCR pass (high-confidence ALL-CAPS words).
// Usage: node scripts/e2e-realcomic.mjs <file.cbz> [baseUrl] [screenshotDir] [--pages 2,10,40]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const file = process.argv[2];
const base = process.argv[3] ?? "http://localhost:5173";
const shots = process.argv[4] ?? ".";
const pagesArg = process.argv.indexOf("--pages");
const PAGES = pagesArg > 0 ? process.argv[pagesArg + 1].split(",").map(Number) : [2, 5, 10, 20, 31, 45, 58, 70, 84, 97, 110, 124];
const PER_PAGE = 8;
const VIEW = { width: 820, height: 1180 };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: VIEW, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const label = () => page.locator("footer").innerText().then((t) => t.replace(/\s+/g, " ").trim());
async function drag2(x0, y0, x1, y1, steps = 6) {
  await touch("touchStart", [[x0, y0]]);
  for (let i = 1; i <= steps; i++) await touch("touchMove", [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(500);
}
const currentIndex = async () => Number(/(\d+) \/ \d+/.exec(await label())?.[1] ?? 0);

// ---- Open -------------------------------------------------------------------------------------
await page.goto(`${base}/#/`);
let t0 = Date.now();
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(file);
await page.waitForURL(/#\/read\//, { timeout: 60000 });
await page.waitForFunction(() => document.querySelector(".comic-view img")?.complete, null, { timeout: 60000 });
console.log(`open: first page shown after ${((Date.now() - t0) / 1000).toFixed(1)} s — ${await label()}`);

/** Go to 1-based page `n` with the keyboard (like the arrow buttons). */
async function goToPage(n) {
  for (let guard = 0; guard < 200; guard++) {
    const cur = await currentIndex();
    if (cur === n) break;
    await page.keyboard.press(cur < n ? "ArrowRight" : "ArrowLeft");
    await page.waitForTimeout(40);
  }
  await page.waitForFunction(() => document.querySelector(".comic-view img")?.complete, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// Reference words are computed with the dev server (it serves node_modules) and cached, so the
// same targets can be tapped on the deployed site.
const cacheFile = fileURLToPath(new URL(`../test-files/targets-${basename(file).replace(/\W+/g, "_")}.json`, import.meta.url));
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

/** High-confidence lettered words on the shown page (fractions of the page) — test targets. */
async function findTargets() {
  const key = `p${await currentIndex()}${page.viewportSize().width > page.viewportSize().height ? "L" : ""}`;
  if (cache[key]) return cache[key];
  const found = await computeTargets();
  cache[key] = found;
  writeFileSync(cacheFile, JSON.stringify(cache));
  return found;
}

async function computeTargets() {
  return page.evaluate(async (perPage) => {
    const T = await import("/node_modules/tesseract.js/dist/tesseract.esm.min.js");
    const createWorker = T.createWorker ?? T.default.createWorker;
    window.__gtWorker ??= await createWorker("eng", 1, {
      workerPath: `${location.origin}/vendor/tesseract/worker.min.js`,
      corePath: `${location.origin}/vendor/tesseract/core`,
      langPath: `${location.origin}/vendor/tesseract/lang`,
      gzip: true,
      workerBlobURL: false,
    });
    const img = document.querySelector(".comic-view img");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth * 2;
    c.height = img.naturalHeight * 2;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    await window.__gtWorker.setParameters({ tessedit_pageseg_mode: "11" });
    const { data } = await window.__gtWorker.recognize(c, {}, { blocks: true });
    const words = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    const good = words
      .filter((w) => w.confidence >= 88 && /^[A-Z][A-Z'’]{2,}[!?.,…-]*$/.test(w.text))
      .map((w) => ({ text: w.text.replace(/[^A-Z'’]/g, ""), cx: (w.bbox.x0 + w.bbox.x1) / 2 / c.width, cy: (w.bbox.y0 + w.bbox.y1) / 2 / c.height, h: (w.bbox.y1 - w.bbox.y0) / c.height }))
      .filter((w) => w.h > 0.004 && w.h < 0.03);
    // Spread the picks over the page.
    const step = Math.max(1, Math.floor(good.length / perPage));
    return good.filter((_, i) => i % step === 0).slice(0, perPage);
  }, PER_PAGE);
}

async function tapAndRead(x, y) {
  await page.evaluate(() => {
    window.__maxScan = 0;
    const tick = () => {
      const m = document.querySelector(".word-mark.is-loading");
      if (m) window.__maxScan = Math.max(window.__maxScan, (m.getBoundingClientRect().width * m.getBoundingClientRect().height) / (innerWidth * innerHeight));
      window.__raf = requestAnimationFrame(tick);
    };
    tick();
  });
  const start = Date.now();
  await page.touchscreen.tap(x, y);
  const dialog = page.locator('[data-slot="popover-dialog"]');
  const shown = await dialog.waitFor({ timeout: 20000 }).then(() => true, () => false);
  const ms = Date.now() - start;
  await page.waitForTimeout(250);
  const info = shown
    ? await page.evaluate(() => {
        const d = document.querySelector('[data-slot="popover-dialog"]');
        const pop = d.closest("[data-word-popup]") ?? d.parentElement;
        const db = d.getBoundingClientRect();
        const pb = pop.getBoundingClientRect();
        const title = d.querySelector(".font-semibold")?.textContent?.trim() ?? "";
        const translation = d.querySelector(".text-accent")?.textContent?.trim() ?? "";
        return { title, translation, inCard: db.bottom <= pb.bottom + 1, onScreen: pb.top >= -1 && pb.bottom <= innerHeight + 1 };
      })
    : null;
  const area = await page.evaluate(() => (cancelAnimationFrame(window.__raf), window.__maxScan));
  const toast = await page.evaluate(() => [...document.querySelectorAll('[data-slot^="toast"]')].map((t) => t.textContent).join(" ").slice(0, 60));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  return { info, ms, area, toast };
}

// ---- Tap words on sample pages ------------------------------------------------------------
const norm = (s) => s.toUpperCase().replace(/[^A-Z]/g, "");
const results = [];
for (const n of PAGES) {
  await goToPage(n);
  const targets = await findTargets();
  const box = await page.locator(".comic-view img").first().boundingBox();
  let line = `p.${String(n).padStart(3)}:`;
  for (const t of targets) {
    const r = await tapAndRead(box.x + box.width * t.cx, box.y + box.height * t.cy);
    const got = r.info?.title ?? "";
    const ok = norm(got) === norm(t.text);
    const partial = !ok && got && (norm(got).includes(norm(t.text)) || norm(t.text).includes(norm(got)));
    results.push({ page: n, want: t.text, got, ok, partial, ms: r.ms, area: r.area, inCard: r.info?.inCard, onScreen: r.info?.onScreen, translation: r.info?.translation, toast: r.toast });
    line += ` ${ok ? "✓" : partial ? "~" : "✗"}${t.text}${ok ? "" : `→${got || `(${r.toast || "no popup"})`}`}`;
    if (!ok) await page.screenshot({ path: `${shots}/real-p${n}-${t.text}.png` }).catch(() => {});
  }
  console.log(line);
}

const n = results.length;
const ok = results.filter((r) => r.ok).length;
const partial = results.filter((r) => r.partial).length;
const none = results.filter((r) => !r.info && !r.got).length;
const slow = [...results].sort((a, b) => b.ms - a.ms);
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`\nwords tapped: ${n} | exact: ${ok} (${Math.round((100 * ok) / n)}%) | close: ${partial} | wrong/none: ${n - ok - partial} (no popup: ${none})`);
console.log(`time: median ${med(results.map((r) => r.ms))} ms, slowest ${slow[0]?.ms} ms | biggest search area ${(100 * Math.max(...results.map((r) => r.area))).toFixed(1)}% of screen`);
console.log(`popup always inside its card: ${results.every((r) => !r.info || r.inCard)} | on screen: ${results.every((r) => r.onScreen !== false)}`);

// ---- Swipe, resume, zoom, landscape -------------------------------------------------------------
await goToPage(30);
await touch("touchStart", [[700, 600]]);
for (let i = 1; i <= 6; i++) await touch("touchMove", [[700 - i * 60, 605]]);
await touch("touchEnd", []);
await page.waitForTimeout(500);
console.log(`swipe left on p.30 → p.${await currentIndex()} (expected 31)`);

await page.waitForTimeout(800);
await page.reload();
await page.waitForFunction(() => document.querySelector(".comic-view img")?.complete, null, { timeout: 60000 });
console.log(`reload → resumes at p.${await currentIndex()} (expected 31)`);

await touch("touchStart", [[350, 500], [470, 500]]);
for (let i = 1; i <= 8; i++) await touch("touchMove", [[350 - i * 15, 500], [470 + i * 15, 500]]);
await touch("touchEnd", []);
await page.waitForTimeout(400);
const tf = await page.evaluate(() => document.querySelector(".comic-view img")?.parentElement?.style.transform ?? "");
console.log(`pinch on tablet → ${tf || "(no zoom)"} | browser zoom: ${await page.evaluate(() => visualViewport.scale)}`);
await page.screenshot({ path: `${shots}/real-zoomed.png` });

// Landscape: page should fill the width; tap a visible word; swipe sideways turns the page.
await touch("touchStart", [[300, 500], [520, 500]]);
for (let i = 1; i <= 8; i++) await touch("touchMove", [[300 + i * 25, 500], [520 - i * 25, 500]]);
await touch("touchEnd", []);
await page.setViewportSize({ width: VIEW.height, height: VIEW.width });
await page.waitForTimeout(1000);
const land = await page.locator(".comic-view img").first().boundingBox();
console.log(`landscape 1180×820: page shown ${Math.round(land.width)} px wide (${Math.round((100 * land.width) / VIEW.height)}% of width)`);
{
  const targets = await findTargets();
  const visible = targets.filter((t) => {
    const y = land.y + land.height * t.cy;
    return y > 90 && y < VIEW.width - 90;
  });
  let okL = 0;
  for (const t of visible.slice(0, 4)) {
    const r = await tapAndRead(land.x + land.width * t.cx, land.y + land.height * t.cy);
    if (norm(r.info?.title ?? "") === norm(t.text)) okL++;
  }
  console.log(`landscape taps: ${okL}/${Math.min(4, visible.length)} correct`);
}
const before = await currentIndex();
await drag2(900, 400, 300, 420);
console.log(`landscape swipe left: p.${before} → p.${await currentIndex()}`);
await page.screenshot({ path: `${shots}/real-landscape.png` });

const mem = await page.evaluate(() => performance.memory?.usedJSHeapSize);
console.log(`JS heap after test: ${mem ? Math.round(mem / 1e6) + " MB" : "n/a"} | page errors: ${errors.length ? errors.slice(0, 3).join(" | ") : "none"}`);
await browser.close();
