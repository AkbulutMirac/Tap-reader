// Offline test (production build, service worker): visit once online, go offline, reload,
// reopen a book from the library and tap a word — the offline dictionary must answer.
// Usage: node scripts/e2e-offline.mjs [baseUrl]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4173";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
const page = await context.newPage();
let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function tap(word) {
  const box = await page.evaluate((w) => {
    const span = [...document.querySelectorAll(".textLayer span")].find((s) => s.textContent.includes(w));
    if (!span) return null;
    const t = span.firstChild;
    const i = t.data.indexOf(w);
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + w.length);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, word);
  await page.mouse.click(box.x, box.y);
  const dialog = page.locator('[data-slot="popover-dialog"]');
  await dialog.waitFor({ timeout: 8000 });
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  await page.keyboard.press("Escape");
  return text;
}

// Online: install the service worker, open the sample, look up a word (caches its dictionary file).
await page.goto(base);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
check(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker controls the page");
await page.getByRole("button", { name: "Try a sample" }).click();
await page.locator(".textLayer span").first().waitFor();
await page.waitForTimeout(500);
check((await tap("bank")).includes("banka"), "online lookup");
// Wait for the background download of the whole dictionary.
const ready = await page
  .waitForFunction(() => !!localStorage.getItem("tapreader.dictReady"), null, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check(ready, "whole dictionary downloaded in the background");

// Offline.
await context.setOffline(true);
await page.goto(`${base}/#/`);
await page.reload();
const title = await page.locator("header").first().innerText().catch(() => "");
check(title.includes("TapReader"), "app loads offline");
await page.getByText("Alice's Adventures in Wonderland").first().click();
await page.locator(".textLayer span").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
const text = await tap("bank");
check(text.includes("banka") && text.includes("Offline dictionary"), "offline lookup from the built-in dictionary", text.slice(0, 80));
const other = await tap("sister");
check(/kız kardeş|abla|bacı|hemşire/i.test(other), "offline lookup of another word in the same dictionary file", other.slice(0, 80));

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
