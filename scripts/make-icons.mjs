// Draws the app icons (open book + translation bubble) in headless Edge → public/icons/.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const out = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();

const draw = (size, maskable) =>
  page.evaluate(
    ({ size, maskable }) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      const s = size / 512;
      // Background: full bleed for maskable, rounded square otherwise.
      const grad = g.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, "#2f7cf6");
      grad.addColorStop(1, "#1d4ed8");
      g.fillStyle = grad;
      if (maskable) g.fillRect(0, 0, size, size);
      else {
        g.beginPath();
        g.roundRect(0, 0, size, size, 112 * s);
        g.fill();
      }
      // Safe zone for maskable icons is the inner 80%.
      const k = maskable ? 0.78 : 1;
      g.translate(size / 2, size / 2);
      g.scale(k * s, k * s);
      g.translate(-256, -256);
      // Open book.
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.moveTo(96, 170);
      g.quadraticCurveTo(176, 140, 248, 176);
      g.lineTo(248, 392);
      g.quadraticCurveTo(176, 358, 96, 386);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(416, 170);
      g.quadraticCurveTo(336, 140, 264, 176);
      g.lineTo(264, 392);
      g.quadraticCurveTo(336, 358, 416, 386);
      g.closePath();
      g.fill();
      // Text lines on the left page.
      g.strokeStyle = "#93b8fb";
      g.lineWidth = 12;
      g.lineCap = "round";
      for (const y of [216, 252, 288, 324]) {
        g.beginPath();
        g.moveTo(130, y);
        g.lineTo(218, y - 6);
        g.stroke();
      }
      // Tapped word highlight on the right page.
      g.fillStyle = "#fde047";
      g.beginPath();
      g.roundRect(292, 236, 92, 34, 10);
      g.fill();
      // Translation bubble.
      g.fillStyle = "#facc15";
      g.beginPath();
      g.roundRect(300, 70, 150, 104, 28);
      g.fill();
      g.beginPath();
      g.moveTo(330, 166);
      g.lineTo(318, 214);
      g.lineTo(362, 170);
      g.fill();
      g.fillStyle = "#1e3a8a";
      g.font = "bold 64px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("Tr", 375, 124);
      return c.toDataURL("image/png").split(",")[1];
    },
    { size, maskable },
  );

for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
  ["favicon-32.png", 32, false],
]) {
  writeFileSync(out + name, Buffer.from(await draw(size, maskable), "base64"));
}
await browser.close();
console.log(`icons written to ${out}`);
