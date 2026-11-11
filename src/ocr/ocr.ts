import type { OcrWord } from "../db";

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let workerPromise: Promise<TesseractWorker> | null = null;

/** One shared Tesseract worker, loaded on first use from the app's own files (works offline). */
function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    const base = new URL(`${import.meta.env.BASE_URL}vendor/tesseract/`, location.href).href;
    return createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      gzip: true,
      workerBlobURL: false,
    });
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

export type PageSegMode = "auto" | "block" | "sparse";
const PSM: Record<PageSegMode, string> = { auto: "3", block: "6", sparse: "11" };

/** Words below this confidence (0–100) are dropped as noise. */
const MIN_CONFIDENCE = 35;

/**
 * Recognize text in a canvas. Word boxes come back in canvas pixels, mapped through `toPage`
 * into page fractions. `group` / line numbers start at the given offsets.
 */
export async function recognize(
  canvas: HTMLCanvasElement,
  mode: PageSegMode,
  toPage: (x: number, y: number) => [number, number],
  firstGroup = 0,
): Promise<OcrWord[]> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: PSM[mode] as never, preserve_interword_spaces: "1" });
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  let line = 0;
  let group = firstGroup;
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const l of para.lines) {
        for (const w of l.words) {
          const text = w.text.trim();
          if (!text || w.confidence < MIN_CONFIDENCE || !/[\p{L}\p{N}]/u.test(text)) continue;
          const [x0, y0] = toPage(w.bbox.x0, w.bbox.y0);
          const [x1, y1] = toPage(w.bbox.x1, w.bbox.y1);
          words.push({ text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, line, group, conf: Math.round(w.confidence) });
        }
        line++;
      }
      group++;
    }
  }
  return words;
}

/** Recognize a whole page image (scanned PDF page, photo of a page). */
export async function recognizePage(source: CanvasImageSource & { width: number; height: number }): Promise<OcrWord[]> {
  // OCR works best around 2000 px wide; larger is slower without being more accurate.
  const scale = Math.min(1, 2200 / source.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return recognize(canvas, "auto", (x, y) => [x / canvas.width, y / canvas.height]);
}
