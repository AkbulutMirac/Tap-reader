/**
 * Find the speech bubble / caption box around a tap on a comic page and prepare it for OCR:
 * flood-fill the box's background from the tap point (white bubbles first, then any flat
 * color, e.g. red caption boxes with white text), take its bounding box, blank everything
 * outside the box, invert light-on-dark text, and upscale.
 */

/** Analysis resolution (px wide) for finding the bubble. */
const ANALYSIS_WIDTH = 800;
/** Pixels at least this bright (0–255) count as bubble background. */
const LIGHT = 200;
/** Max color distance (RGB) from the seed for flat-colored caption boxes. */
const COLOR_TOLERANCE = 42;
/** A "bubble" bigger than this share of the page is really the page background or gutters. */
const MAX_BUBBLE_SHARE = 0.12;
/** Regions touching the image edge are margins/gutters, unless tiny. */
const MAX_EDGE_SHARE = 0.02;
/** Bubble box limits (share of page width / height). */
const MAX_BUBBLE_W = 0.6;
const MAX_BUBBLE_H = 0.45;
/** Smallest bubble: share of the page area, and box size as share of page width / height. */
const MIN_BUBBLE_SHARE = 0.0015;
const MIN_BUBBLE_W = 0.03;
const MIN_BUBBLE_H = 0.015;

export interface CropOptions {
  /** Hard black/white threshold (Otsu) instead of grayscale. */
  binarize?: boolean;
  /** Small crops are enlarged to about this width (Tesseract reads mid-size letters best). */
  targetWidth?: number;
  maxUpscale?: number;
  /** Also look for flat-colored caption boxes, not just light bubbles. */
  colorBoxes?: boolean;
  /** Skip bubble detection: crop a window around the tap. */
  window?: boolean;
}

// Measured on a real comic (scripts/ocr-bench.mjs): gray + little enlargement read best.
export const DEFAULT_CROP: Required<CropOptions> = {
  binarize: false,
  targetWidth: 350,
  maxUpscale: 1.5,
  colorBoxes: true,
  window: false,
};

export interface BubbleCrop {
  canvas: HTMLCanvasElement;
  /** Maps crop-canvas pixels to page fractions. */
  toPage: (x: number, y: number) => [number, number];
  /** Bubble box as page fractions. */
  box: { x: number; y: number; w: number; h: number };
  /** True when no bubble was found and a box around the tap was used instead. */
  fallback: boolean;
  /** Light pixels or a flat box near the tap; false means the tap was on artwork. */
  nearLight: boolean;
}

function luma(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/** Otsu threshold of a grayscale histogram. */
export function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

type Inside = (p: number) => boolean;

/**
 * Flood-fill one region of pixels that satisfy `inside`, from `start`, marking visited pixels
 * in `seen`. Returns the pixels if the region could be a speech bubble / caption box, else null.
 */
function fillRegion(w: number, h: number, start: number, seen: Uint8Array, inside: Inside) {
  const pixels: number[] = [start];
  seen[start] = 1;
  let touchesEdge = false;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  const limit = w * h * MAX_BUBBLE_SHARE;
  let tooBig = false;
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const x = p % w;
    const y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
    // Keep filling past the limit (marking `seen`) so this region isn't tried again.
    if (pixels.length > limit) tooBig = true;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !seen[q] && inside(q)) {
        seen[q] = 1;
        pixels.push(q);
      }
    }
  }
  const count = pixels.length;
  const ok =
    !tooBig &&
    count >= w * h * MIN_BUBBLE_SHARE &&
    x1 - x0 >= w * MIN_BUBBLE_W &&
    y1 - y0 >= h * MIN_BUBBLE_H &&
    x1 - x0 <= w * MAX_BUBBLE_W &&
    y1 - y0 <= h * MAX_BUBBLE_H &&
    !(touchesEdge && count > w * h * MAX_EDGE_SHARE);
  return ok ? { pixels, box: [x0, y0, x1, y1] as const } : null;
}

/**
 * Try regions starting from rings of points around (sx, sy), nearest ring first. The first ring
 * that yields a plausible region wins (largest within that ring), so a tap inside a letter's
 * hole still finds its bubble, but a bigger bubble next door doesn't beat the one tapped.
 */
function bestRegion(w: number, h: number, sx: number, sy: number, canStart: Inside, makeInside: (start: number) => Inside, accept: (r: { pixels: number[]; box: readonly [number, number, number, number] }) => boolean = () => true) {
  const seen = new Uint8Array(w * h);
  const reach = Math.max(14, Math.round(w * 0.03));
  for (let r = 0; r <= reach; r += 3) {
    let best: { pixels: number[]; box: readonly [number, number, number, number] } | null = null;
    for (let a = 0; a < (r ? 12 : 1); a++) {
      const x = Math.round(sx + r * Math.cos((a * Math.PI) / 6));
      const y = Math.round(sy + r * Math.sin((a * Math.PI) / 6));
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = y * w + x;
      if (seen[p] || !canStart(p)) continue;
      const region = fillRegion(w, h, p, seen, makeInside(p));
      if (region && accept(region) && (!best || region.pixels.length > best.pixels.length)) best = region;
    }
    if (best) return best;
  }
  return null;
}

const toMask = (w: number, h: number, pixels: number[]) => {
  const mask = new Uint8Array(w * h);
  for (const p of pixels) mask[p] = 1;
  return mask;
};

/**
 * The light speech bubble around (sx, sy) in a w×h luma grid, as a mask, or null.
 * The tap usually lands on a dark letter or inside a letter's hole ("O"), so regions starting
 * from several points around the tap are tried and the largest plausible one wins.
 */
export function floodLight(gray: Float32Array, w: number, h: number, sx: number, sy: number): Uint8Array | null {
  const light: Inside = (p) => gray[p] >= LIGHT;
  const best = bestRegion(w, h, sx, sy, light, () => light);
  return best ? toMask(w, h, best.pixels) : null;
}

/** Pixels inside the box (x0..x1, y0..y1) that are enclosed by the region (letters). */
function holesOf(mask: Uint8Array, w: number, [x0, y0, x1, y1]: readonly [number, number, number, number]) {
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const outside = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * bw + x;
    if (!outside[i] && !mask[(y0 + y) * w + x0 + x]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < bw; x++) {
    push(x, 0);
    push(x, bh - 1);
  }
  for (let y = 0; y < bh; y++) {
    push(0, y);
    push(bw - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % bw;
    const y = (i - x) / bw;
    if (x > 0) push(x - 1, y);
    if (x < bw - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < bh - 1) push(x, y + 1);
  }
  return outside;
}

/**
 * A flat-colored caption box (any color) around (sx, sy) that contains text: the region must
 * enclose enough contrasting "holes" (letters). Returns the mask and whether the text is light.
 */
export function floodColorBox(rgb: Uint8ClampedArray, gray: Float32Array, w: number, h: number, sx: number, sy: number) {
  const dist2 = (p: number, q: number) =>
    (rgb[p * 4] - rgb[q * 4]) ** 2 + (rgb[p * 4 + 1] - rgb[q * 4 + 1]) ** 2 + (rgb[p * 4 + 2] - rgb[q * 4 + 2]) ** 2;
  const tol2 = COLOR_TOLERANCE ** 2;
  let lightText = false;
  const best = bestRegion(
    w,
    h,
    sx,
    sy,
    () => true,
    (seed) => (p) => dist2(p, seed) <= tol2,
    (region) => {
      const mask = toMask(w, h, region.pixels);
      const outside = holesOf(mask, w, region.box);
      const [x0, y0, x1, y1] = region.box;
      const bw = x1 - x0 + 1;
      let holes = 0;
      let holeLuma = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = y * w + x;
          if (mask[p] || outside[(y - y0) * bw + (x - x0)]) continue;
          holes++;
          holeLuma += gray[p];
        }
      }
      const area = bw * (y1 - y0 + 1);
      if (holes < area * 0.02 || holes > area * 0.6) return false;
      const bg = gray[region.pixels[0]];
      const fg = holeLuma / holes;
      if (Math.abs(fg - bg) < 60) return false;
      // Mostly box-shaped (bubbles/captions), not a ragged patch of artwork.
      if ((region.pixels.length + holes) / area < 0.55) return false;
      lightText = fg > bg;
      return true;
    },
  );
  return best ? { mask: toMask(w, h, best.pixels), lightText } : null;
}

export async function cropBubble(
  image: CanvasImageSource & { width: number; height: number },
  tapX: number,
  tapY: number,
  options: CropOptions = {},
): Promise<BubbleCrop> {
  const opt = { ...DEFAULT_CROP, ...options };
  const W = image.width;
  const H = image.height;
  const s = Math.min(1, ANALYSIS_WIDTH / W);
  const aw = Math.max(1, Math.round(W * s));
  const ah = Math.max(1, Math.round(H * s));
  const small = document.createElement("canvas");
  small.width = aw;
  small.height = ah;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(image, 0, 0, aw, ah);
  const px = sctx.getImageData(0, 0, aw, ah).data;
  const gray = new Float32Array(aw * ah);
  for (let i = 0; i < gray.length; i++) gray[i] = luma(px, i * 4);

  const sx = Math.round(tapX * aw);
  const sy = Math.round(tapY * ah);
  let nearLight = false;
  for (let y = Math.max(0, sy - 10); y <= Math.min(ah - 1, sy + 10) && !nearLight; y++) {
    for (let x = Math.max(0, sx - 10); x <= Math.min(aw - 1, sx + 10); x++) {
      if (gray[y * aw + x] >= LIGHT) {
        nearLight = true;
        break;
      }
    }
  }

  // White/light bubbles first; then flat-colored caption boxes.
  let mask = opt.window ? null : floodLight(gray, aw, ah, sx, sy);
  let invert = false;
  if (!mask && opt.colorBoxes && !opt.window) {
    const box = floodColorBox(px, gray, aw, ah, sx, sy);
    if (box) {
      mask = box.mask;
      invert = box.lightText;
      nearLight = true;
    }
  }

  // Bubble box in analysis pixels (or a box around the tap as a fallback).
  let bx0 = aw;
  let by0 = ah;
  let bx1 = 0;
  let by1 = 0;
  if (mask) {
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const x = i % aw;
      const y = (i - x) / aw;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  } else {
    bx0 = Math.max(0, Math.round((tapX - 0.22) * aw));
    bx1 = Math.min(aw - 1, Math.round((tapX + 0.22) * aw));
    by0 = Math.max(0, Math.round((tapY - 0.07) * ah));
    by1 = Math.min(ah - 1, Math.round((tapY + 0.07) * ah));
  }
  const pad = 2;
  bx0 = Math.max(0, bx0 - pad);
  by0 = Math.max(0, by0 - pad);
  bx1 = Math.min(aw - 1, bx1 + pad);
  by1 = Math.min(ah - 1, by1 + pad);
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;

  // Pixels outside the bubble (reachable from the box edge without crossing it) get blanked;
  // letters are holes inside the bubble and stay.
  const outside = mask ? holesOf(mask, aw, [bx0, by0, bx1, by1]) : null;

  // Crop from the full-resolution image and upscale small bubbles.
  const fx = bx0 / s;
  const fy = by0 / s;
  const fw = bw / s;
  const fh = bh / s;
  const up = Math.min(opt.maxUpscale, Math.max(1, opt.targetWidth / fw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(fw * up);
  canvas.height = Math.round(fh * up);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, fx, fy, fw, fh, 0, 0, canvas.width, canvas.height);

  // Grayscale (inverted for light-on-dark text), optionally binarized; outside forced white.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const g = new Uint8Array(canvas.width * canvas.height);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.length; i++) {
    const v = Math.round(luma(d, i * 4));
    g[i] = invert ? 255 - v : v;
    hist[g[i]]++;
  }
  const t = opt.binarize ? otsu(hist, g.length) : -1;
  for (let i = 0; i < g.length; i++) {
    const x = i % canvas.width;
    const y = (i - x) / canvas.width;
    // Same pixel in the analysis box grid.
    const ax = Math.min(bw - 1, Math.floor((x / canvas.width) * bw));
    const ay = Math.min(bh - 1, Math.floor((y / canvas.height) * bh));
    const v = outside?.[ay * bw + ax] ? 255 : t >= 0 ? (g[i] > t ? 255 : 0) : g[i];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  return {
    canvas,
    toPage: (x, y) => [(fx + x / up) / W, (fy + y / up) / H],
    box: { x: fx / W, y: fy / H, w: fw / W, h: fh / H },
    fallback: !mask,
    nearLight,
  };
}
