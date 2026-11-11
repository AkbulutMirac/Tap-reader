// Compare comic formats: CBZ (PNG), "smaller" CBZ (WebP) and image-only PDF.
// Taps two words in speech bubbles and reports the result and time for each.
// Usage: node scripts/e2e-comics.mjs [baseUrl]
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const files = fileURLToPath(new URL("../test-files/", import.meta.url));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
let failed = 0;

// Word positions as fractions of the comic page.
const TARGETS = [
  ["treasure", 0.25, 241 / 1400],
  ["ancient", 0.61, 581 / 1400],
];

for (const [file, pageSelector] of [
  ["comic.cbz", ".comic-view img"],
  ["comic-small.cbz", ".comic-view img"],
  ["comic.pdf", ".pdf-page"],
]) {
  await page.goto(`${base}/#/`);
  await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(files + file);
  await page.waitForURL(/#\/read\//);
  const target = page.locator(pageSelector).first();
  await target.waitFor();
  await page.waitForTimeout(800);
  const box = await target.boundingBox();
  for (const [word, fx, fy] of TARGETS) {
    const t0 = Date.now();
    await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
    const dialog = page.locator('[data-slot="popover-dialog"]');
    const ok = await dialog
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    const text = ok ? (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 60) : "no popup";
    const hit = ok && text.toLowerCase().includes(word);
    if (!hit) failed++;
    console.log(`${hit ? "✓" : "✗"} ${file.padEnd(16)} "${word}" ${((Date.now() - t0) / 1000).toFixed(1)} s | ${text}`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
