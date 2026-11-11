// Copies runtime files that must be served as-is (not bundled) into public/vendor/:
//   pdf.js CMaps, standard fonts and wasm decoders
//   Tesseract.js worker, LSTM cores and English model (OCR)
//   libarchive.js worker + wasm (CBR/CB7 comics)
// Runs on install and before dev/build. public/vendor/ is git-ignored.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

// fs.cpSync crashes Node 22 on some Windows paths, so copy by hand.
function copy(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) copy(`${from}/${name}`, `${to}/${name}`);
  } else {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const nm = `${root}node_modules/`;
const out = `${root}public/vendor/`;

const copies = [
  ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["pdfjs-dist/wasm", "pdfjs/wasm"],
  ["tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract/core/tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract/core/tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "tesseract/lang/eng.traineddata.gz"],
  ["libarchive.js/dist/worker-bundle.js", "libarchive/worker-bundle.js"],
  ["libarchive.js/dist/libarchive.wasm", "libarchive/libarchive.wasm"],
];

rmSync(`${root}public/pdfjs`, { recursive: true, force: true }); // old location
for (const [from, to] of copies) {
  if (!existsSync(nm + from)) {
    console.warn(`copy-assets: missing ${from}`);
    continue;
  }
  copy(nm + from, out + to);
}
