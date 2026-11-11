// Phone test for comics: captions vs bubbles, size of the OCR search area, popup layout,
// in-app pinch zoom / drag (real multi-touch via CDP) and tapping while zoomed. Also PDF pinch.
// Usage: node scripts/e2e-zoom.mjs [baseUrl] [screenshotDir]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5173";
const shots = process.argv[3] ?? ".";
const files = fileURLToPath(new URL("../test-files/", import.meta.url));
const targets = JSON.parse(readFileSync(files + "comic-captions.json", "utf8"));
const VIEW = { width: 412, height: 915 };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: VIEW, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const touch = (type, points) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

async function pinch(cx, cy, from, to, steps = 8) {
  await touch("touchStart", [[cx - from, cy], [cx + from, cy]]);
  for (let i = 1; i <= steps; i++) {
    const d = from + ((to - from) * i) / steps;
    await touch("touchMove", [[cx - d, cy], [cx + d, cy]]);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(300);
}
async function drag(x0, y0, x1, y1, steps = 8) {
  await touch("touchStart", [[x0, y0]]);
  for (let i = 1; i <= steps; i++) await touch("touchMove", [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(300);
}

/** Tap at (x, y); return popup info and the largest "reading" box shown meanwhile. */
async function tapAndRead(x, y) {
  await page.evaluate(() => {
    window.__maxScan = 0;
    const tick = () => {
      const m = document.querySelector(".word-mark.is-loading");
      if (m) window.__maxScan = Math.max(window.__maxScan, m.getBoundingClientRect().width / innerWidth);
      window.__scanRaf = requestAnimationFrame(tick);
    };
    tick();
  });
  await page.touchscreen.tap(x, y);
  const dialog = page.locator('[data-slot="popover-dialog"]');
  const ok = await dialog.waitFor({ timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(350);
  const info = ok
    ? await page.evaluate(() => {
        const d = document.querySelector('[data-slot="popover-dialog"]');
        const p = d.closest("[data-word-popup]") ?? d.parentElement;
        const db = d.getBoundingClientRect();
        const pb = p.getBoundingClientRect();
        return {
          text: d.innerText.replace(/\s+/g, " ").slice(0, 70),
          inside: db.bottom <= pb.bottom + 1 && db.top >= pb.top - 1,
          scrollable: d.scrollHeight > d.clientHeight + 1,
          popupW: pb.width,
          onScreen: pb.top >= 0 && pb.bottom <= innerHeight + 1,
          font: parseFloat(getComputedStyle(d).fontSize),
        };
      })
    : null;
  const maxScan = await page.evaluate(() => (cancelAnimationFrame(window.__scanRaf), window.__maxScan));
  return { info, maxScan };
}
async function closePopup() {
  await page.keyboard.press("Escape");
  await page.locator('[data-slot="popover-dialog"]').waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

// ---- Comic page with captions -----------------------------------------------------------------
await page.goto(`${base}/#/`);
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(files + "comic-captions.cbz");
await page.waitForURL(/#\/read\//);
const img = page.locator(".comic-view img").first();
await img.waitFor();
await page.waitForTimeout(800);
const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
check(meta.includes("user-scalable=no"), "browser zoom is off in the reader");

let box = await img.boundingBox();
for (const t of targets) {
  const { info, maxScan } = await tapAndRead(box.x + box.width * t.cx, box.y + box.height * t.cy);
  const word = t.word.replace(/\W/g, "").toLowerCase();
  const ok = !!info && info.text.toLowerCase().includes(word) && info.inside && info.onScreen;
  check(ok, `tap "${t.word}"`, info ? `${info.text} | in card: ${info.inside}, search area ${(maxScan * 100).toFixed(0)}% of width` : "no popup");
  check(maxScan < 0.6, `  search area stays small for "${t.word}"`, `${(maxScan * 100).toFixed(0)}%`);
  if (t.word === "THOUGHT") await page.screenshot({ path: `${shots}/zoom-caption-popup.png` });
  await closePopup();
}

// ---- Pinch zoom, drag, tap while zoomed -------------------------------------------------------
const transformOf = () => page.evaluate(() => document.querySelector(".comic-view img")?.parentElement?.style.transform ?? "");
// Zoom in around the "PROTOCOLS" bubble (the pinched spot stays under the fingers).
const p = targets.find((t) => t.word === "PROTOCOLS");
const px = box.x + box.width * p.cx;
const py = box.y + box.height * p.cy;
await pinch(Math.min(px, VIEW.width - 100), py, 30, 90);
const t1 = await transformOf();
const scale = Number(/scale\(([\d.]+)\)/.exec(t1)?.[1] ?? 1);
check(scale > 2, "pinch zooms the page in the app", t1);
await drag(200, 400, 230, 410);
const t2 = await transformOf();
check(t2 !== t1, "one finger drags the zoomed page", t2);
check((await page.evaluate(() => visualViewport.scale)) === 1, "browser page zoom stays at 1");

// Tap a word that is visible now (its OCR text is on the page from the taps above).
const visible = await page.evaluate(() => {
  const spans = [...document.querySelectorAll(".ocr-layer span")];
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (r.width > 10 && r.left > 10 && r.right < innerWidth - 10 && r.top > 80 && r.bottom < innerHeight - 80) {
      return { text: s.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return null;
});
if (visible) {
  const { info } = await tapAndRead(visible.x, visible.y);
  check(
    !!info && info.popupW <= 360 && info.font <= 15 && info.inside,
    `tap "${visible.text}" while zoomed: popup has normal size`,
    info ? `width ${Math.round(info.popupW)} px, text ${info.font}px | ${info.text}` : "no popup",
  );
  await page.screenshot({ path: `${shots}/zoom-zoomed-popup.png` });
  await closePopup();
} else check(false, "a recognized word is visible while zoomed");

await pinch(VIEW.width / 2, VIEW.height / 2, 160, 20);
check(!/scale\(/.test(await transformOf()), "pinching out returns to normal size");

// ---- PDF pinch ---------------------------------------------------------------------------------
await page.goto(`${base}/#/`);
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(files + "scanned.pdf");
await page.waitForURL(/#\/read\//);
const pdfPage = page.locator(".pdf-page").first();
await pdfPage.waitFor();
await page.waitForTimeout(800);
const w0 = (await pdfPage.boundingBox()).width;
await pinch(VIEW.width / 2, 400, 40, 110);
await page.waitForTimeout(800);
const w1 = (await pdfPage.boundingBox()).width;
check(w1 > w0 * 1.8, "PDF pinch zooms the pages", `${Math.round(w0)} → ${Math.round(w1)} px wide`);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("tapreader.settings") || "{}");
  localStorage.setItem("tapreader.settings", JSON.stringify({ ...s, pdfZoom: 1 }));
});

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
