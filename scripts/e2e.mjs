// End-to-end test in headless Edge: open every test file (node scripts/make-test-files.mjs),
// tap a word, and check the translation popup. Screenshots go to the given folder.
// Usage: node scripts/e2e.mjs [baseUrl] [screenshotDir] [--mobile | --tablet | --tablet-landscape]
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const shots = process.argv[3] ?? ".";
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 860 }, touch: false, scale: 1 },
  mobile: { viewport: { width: 390, height: 844 }, touch: true, scale: 2 },
  tablet: { viewport: { width: 820, height: 1180 }, touch: true, scale: 2 },
  "tablet-landscape": { viewport: { width: 1180, height: 820 }, touch: true, scale: 2 },
};
const deviceName = Object.keys(DEVICES).find((d) => process.argv.includes(`--${d}`)) ?? "desktop";
const device = DEVICES[deviceName];
const mobile = device.touch;
const files = fileURLToPath(new URL("../test-files/", import.meta.url));
const viewport = device.viewport;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: device.scale });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => {
  errors.push(`unexpected dialog: ${d.message()}`);
  void d.dismiss();
});

let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const tapAt = async (x, y) => (mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
const popup = () => page.locator('[data-slot="popover-dialog"]');

/** Box of `word` in the top page or any iframe (e-books render in iframes), in page coordinates. */
async function findWord(word) {
  for (const frame of page.frames()) {
    const box = await frame
      .evaluate((w) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.data.indexOf(w);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + w.length);
          const b = r.getBoundingClientRect();
          if (b.width > 0 && b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight) {
            return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom };
          }
        }
        return null;
      }, word)
      .catch(() => null);
    if (!box) continue;
    if (frame === page.mainFrame()) return box;
    const fb = await (await frame.frameElement()).boundingBox();
    if (!fb) continue;
    return { x: fb.x + box.x, y: fb.y + box.y, top: fb.y + box.top, bottom: fb.y + box.bottom };
  }
  return null;
}

async function expectPopup(label, word, expectText, box, timeout = 8000) {
  try {
    await popup().waitFor({ timeout });
  } catch {
    check(false, label, `no popup for "${word}"`);
    return;
  }
  await page.waitForTimeout(350);
  const text = (await popup().innerText()).replace(/\s+/g, " ");
  const d = await popup().boundingBox();
  const above = box ? d.y + d.height <= box.top + 4 : true;
  const onScreen = d.y >= 0 && d.y + d.height <= viewport.height + 1;
  check(text.toLowerCase().includes(expectText.toLowerCase()) && onScreen, label, `${above ? "above" : "BELOW"} word | ${text.slice(0, 90)}`);
  await page.screenshot({ path: `${shots}/e2e-${deviceName}-${label.replace(/\W+/g, "_")}.png` });
  await page.keyboard.press("Escape");
  await popup().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

async function openFile(name) {
  await page.goto(`${base}/#/`);
  await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(files + name);
  await page.waitForURL(/#\/read\//, { timeout: 10000 });
}

async function tapWordIn(label, word, expectText = word, wait = 15000) {
  const start = Date.now();
  let box = null;
  while (!box && Date.now() - start < wait) {
    box = await findWord(word);
    if (!box) await page.waitForTimeout(300);
  }
  if (!box) return check(false, label, `"${word}" not visible`);
  await tapAt(box.x, box.y);
  await expectPopup(label, word, expectText, box);
}

// 1. Sample PDF from the empty library.
await page.goto(base);
await page.getByRole("button", { name: "Try a sample" }).click();
await page.waitForURL(/#\/read\//);
await page.locator(".textLayer span").first().waitFor();
await page.waitForTimeout(500);
await tapWordIn("pdf sample", "bank", "banka");

// Save a word and check the Words screen.
{
  const box = await findWord("peeped");
  await tapAt(box.x, box.y);
  await popup().waitFor();
  await page.getByRole("button", { name: "Save to word list" }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.goto(`${base}/#/words`);
  const listed = await page
    .getByText("peeped", { exact: true })
    .first()
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check(listed, "word list shows saved word");
  await page.screenshot({ path: `${shots}/e2e-${deviceName}-words.png` });
}

// 2. Every other format.
for (const [file, word, expectText] of [
  ["story.epub", "lighthouse", "fener"],
  ["story.docx", "lighthouse", "fener"],
  ["story.txt", "lighthouse", "fener"],
  ["story.md", "lighthouse", "fener"],
  ["story.html", "lighthouse", "fener"],
  ["story.rtf", "lighthouse", "fener"],
]) {
  await openFile(file);
  await page.waitForTimeout(1200);
  await tapWordIn(file, word, expectText);
  if (file === "story.epub") {
    // Chapter two contains <script>alert()</script>: turn pages so it loads; CSP must block it.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(600);
    }
    const ch2 = await findWord("next morning");
    check(!!ch2, "epub: page turning reaches chapter two");
    const ran = await page.evaluate(() => !!window.__epubScriptRan);
    console.log(`  e-book script ran: ${ran}`);
    if (process.argv.includes("--expect-csp")) check(!ran, "epub: script inside the book is blocked");
  }
}

// 3. Scanned PDF: first tap runs OCR on the page.
{
  await openFile("scanned.pdf");
  await page.locator(".pdf-page canvas").first().waitFor();
  await page.waitForTimeout(800);
  const pg = await page.locator(".pdf-page").first().boundingBox();
  // "lighthouse" in the first line: x ≈ 320/1240, y ≈ 190/1754 of the page.
  const x = pg.x + pg.width * (320 / 1240);
  const y = pg.y + pg.height * (190 / 1754);
  const t0 = Date.now();
  await tapAt(x, y);
  await expectPopup("scanned pdf (OCR)", "lighthouse", "lighthouse", null, 90000);
  console.log(`  OCR + lookup took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// 4. Comic: tap a word in a speech bubble.
{
  await openFile("comic.cbz");
  const img = page.locator(".comic-view img").first();
  await img.waitFor();
  await page.waitForTimeout(500);
  const b = await img.boundingBox();
  // "TREASURE" in the first bubble: about (250/1000, 241/1400) of the page.
  const t0 = Date.now();
  await tapAt(b.x + b.width * 0.25, b.y + b.height * (241 / 1400));
  await expectPopup("comic bubble (OCR)", "treasure", "treasure", null, 90000);
  console.log(`  bubble OCR + lookup took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// 5. Library lists everything.
await page.goto(`${base}/#/`);
await page.waitForTimeout(500);
const cards = await page.locator("main ul li").count();
check(cards >= 9, "library lists the opened files", `${cards} items`);
await page.screenshot({ path: `${shots}/e2e-${deviceName}-library.png` });

check(errors.length === 0, "no page errors or dialogs", errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
