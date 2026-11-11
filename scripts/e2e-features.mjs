// Feature test in headless Edge: contents/search/display panels, dark theme,
// highlights, bookmarks, flashcard review and backup export.
// Usage: node scripts/e2e-features.mjs [baseUrl] [screenshotDir] [--tablet]
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const shots = process.argv[3] ?? ".";
const tablet = process.argv.includes("--tablet");
const files = fileURLToPath(new URL("../test-files/", import.meta.url));
const viewport = tablet ? { width: 820, height: 1180 } : { width: 1280, height: 860 };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport, hasTouch: tablet, isMobile: tablet, deviceScaleFactor: tablet ? 2 : 1, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const shot = (name) => page.screenshot({ path: `${shots}/feat-${tablet ? "tablet" : "desktop"}-${name}.png` });
const press = async (name) => {
  // The bars hide while reading; the "Show menu" button brings them back.
  const show = page.getByRole("button", { name: "Show menu" });
  if (await show.isVisible().catch(() => false)) {
    await show.click();
    await page.waitForTimeout(300);
  }
  await page.getByRole("button", { name, exact: true }).first().click();
};
const drawer = () => page.locator('[data-slot="drawer-dialog"], [role="dialog"]').last();

async function openFile(name) {
  await page.goto(`${base}/#/`);
  await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(files + name);
  await page.waitForURL(/#\/read\//, { timeout: 10000 });
}

// ---- E-book panels ---------------------------------------------------------------------------
await openFile("story.epub");
await page.waitForTimeout(1500);

await press("Contents");
await page.getByText("Chapter Two", { exact: true }).first().waitFor({ timeout: 5000 });
check(true, "contents panel lists chapters");
await shot("toc");
await page.getByText("Chapter Two", { exact: true }).first().click();
await page.waitForTimeout(1200);
const footer = await page.locator("footer").innerText();
check(/Chapter Two/.test(footer), "contents jumps to chapter", footer.replace(/\s+/g, " "));

await press("Search");
await page.getByRole("searchbox").fill("lantern");
await page.keyboard.press("Enter");
await page.getByText(/results?/).first().waitFor({ timeout: 10000 }).catch(() => {});
const resultText = await drawer().innerText();
check(/lantern/i.test(resultText) && /1 results|results/.test(resultText), "search finds text", resultText.replace(/\s+/g, " ").slice(0, 80));
await shot("search");
await page.getByRole("button", { name: "Close panel" }).click();
await page.waitForTimeout(500);

await press("Display settings");
await page.getByRole("button", { name: "Dark", exact: true }).click();
await page.waitForTimeout(500);
const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
check(dark, "dark theme applies");
await page.getByRole("button", { name: "Increase Text size" }).click();
await page.waitForTimeout(300);
await shot("display-dark");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await shot("reader-dark");

// Bookmark the current page.
await press("Add bookmark");
await page.waitForTimeout(400);
check(await page.getByRole("button", { name: "Remove bookmark" }).isVisible(), "bookmark added");

// Highlight: select text in the book frame, then press Highlight.
{
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith("blob:"));
  let selected = false;
  for (const f of page.frames()) {
    selected = await f
      .evaluate(() => {
        const p = [...document.querySelectorAll("p")].find((x) => x.getBoundingClientRect().width > 0 && x.textContent.length > 40);
        if (!p) return false;
        const r = document.createRange();
        r.setStart(p.firstChild, 0);
        r.setEnd(p.firstChild, 20);
        const s = document.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return true;
      })
      .catch(() => false);
    if (selected) break;
  }
  void frame;
  await page.waitForTimeout(400);
  const bar = page.getByRole("button", { name: "Highlight", exact: true });
  const barShown = await bar.isVisible().catch(() => false);
  check(selected && barShown, "selection shows Translate / Highlight bar");
  if (barShown) {
    await shot("selection-bar");
    await bar.click();
    await page.waitForTimeout(500);
    await press("Highlights and bookmarks");
    const marks = await drawer().innerText();
    check(/Highlights \(1\)/.test(marks), "highlight saved", marks.replace(/\s+/g, " ").slice(0, 60));
    await shot("marks");
    await page.keyboard.press("Escape");
  }
}

// ---- Light theme back, then flashcards ----------------------------------------------------------
await page.goto(`${base}/#/settings`);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("tapreader.settings") || "{}");
  localStorage.setItem("tapreader.settings", JSON.stringify({ ...s, theme: "light" }));
});
await page.reload();
await shot("settings");

// Save a word from the sample, then review it.
await page.goto(`${base}/#/`);
await page.getByRole("button", { name: /Try a sample|Add file/ }).first().waitFor();
await openFile("story.txt");
await page.waitForTimeout(1500);
for (const f of page.frames()) {
  const box = await f
    .evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = n.data.indexOf("notebook");
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 8);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    })
    .catch(() => null);
  if (!box) continue;
  const fb = f === page.mainFrame() ? { x: 0, y: 0 } : await (await f.frameElement()).boundingBox();
  if (tablet) await page.touchscreen.tap(fb.x + box.x, fb.y + box.y);
  else await page.mouse.click(fb.x + box.x, fb.y + box.y);
  break;
}
await page.getByRole("button", { name: "Save to word list" }).click({ timeout: 8000 });
await page.waitForTimeout(300);
await page.goto(`${base}/#/words`);
await page.getByRole("tab", { name: /Review/ }).click();
await page.getByRole("button", { name: "Start review" }).click();
await page.getByRole("button", { name: "Show meaning" }).click();
await shot("review");
await page.getByRole("button", { name: "I knew it" }).click();
check(
  await page
    .getByText(/Done! You reviewed 1 card/)
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false),
  "flashcard review works",
);

// Backup export downloads a JSON file.
await page.getByRole("tab", { name: /My words/ }).click();
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.getByRole("button", { name: /Backup/ }).click()]);
const path = await download.path();
const json = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
check(json.app === "tapreader" && json.words.length >= 1, "backup export", `${json.words.length} words, ${json.highlights.length} highlights, ${json.bookmarks.length} bookmarks`);

check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
