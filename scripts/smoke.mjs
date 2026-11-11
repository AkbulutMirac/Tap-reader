// End-to-end smoke test in headless Edge: open the sample PDF, tap words, check the popup.
// Usage: node scripts/smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5173";
const shots = process.argv[3] ?? ".";
const WORDS = ["bank", "peeped", "considering", "waistcoat"];

const browser = await chromium.launch({ channel: "msedge", headless: true });
let failed = 0;

for (const [label, viewport, isMobile] of [
  ["desktop", { width: 1280, height: 800 }, false],
  ["mobile", { width: 390, height: 844 }, true],
]) {
  const page = await browser.newPage({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 3 : 1 });
  page.on("console", (m) => m.type() === "error" && console.log(`  [${label} console] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`  [${label} pageerror] ${e.message}`));
  await page.goto(base);
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.locator(".textLayer span").first().waitFor();

  for (const word of WORDS) {
    const box = await page.evaluate((w) => {
      const span = [...document.querySelectorAll(".textLayer span")].find((s) => s.textContent.includes(w));
      if (!span) return null;
      span.scrollIntoView({ block: "center" });
      const t = span.firstChild;
      const i = t.data.indexOf(w);
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + w.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, bottom: b.bottom, top: b.top };
    }, word);
    if (!box) {
      console.log(`✗ ${label}: "${word}" not found in text layer`);
      failed++;
      continue;
    }
    // Let the scroll event from scrollIntoView fire first (scrolling closes the popup).
    await page.waitForTimeout(150);
    const t0 = Date.now();
    if (isMobile) await page.touchscreen.tap(box.x, box.y);
    else await page.mouse.click(box.x, box.y);
    const dialog = page.locator('[data-slot="popover-dialog"]');
    try {
      await dialog.waitFor({ timeout: 5000 });
    } catch {
      console.log(`✗ ${label}: no popup for "${word}"`);
      failed++;
      continue;
    }
    const ms = Date.now() - t0;
    const text = (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 90);
    const d = await dialog.boundingBox();
    const onScreen = d.y >= 0 && d.y + d.height <= viewport.height + 1 && d.x >= 0 && d.x + d.width <= viewport.width + 1;
    const near = Math.min(Math.abs(d.y - box.bottom), Math.abs(d.y + d.height - box.top)) < 30;
    const ok = text.toLowerCase().includes(word) && onScreen && near;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${label}: "${word}" ${ms}ms onScreen=${onScreen} nearWord=${near} | ${text}`);
    await page.waitForTimeout(400); // let the open animation finish
    await page.screenshot({ path: `${shots}/smoke-${label}-${word}.png` });
    // Tap empty margin: popup should close.
    await page.mouse.click(4, viewport.height - 4);
    await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {
      console.log(`✗ ${label}: popup did not close after tapping outside`);
      failed++;
    });
  }
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
