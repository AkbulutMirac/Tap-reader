import { useEffect, useRef, type RefObject } from "react";

/**
 * In-app pinch zoom. The browser's own pinch zoom is turned off in the reader
 * (see useNoBrowserZoom), because it scales fixed elements like the word popup and
 * fights with page swipes.
 */

const MIN_MOVE = 8;
const SWIPE_PX = 60;

const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a: Touch, b: Touch) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Turns off the browser's page zoom while the reader is open (restored on leave). */
export function useNoBrowserZoom(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const before = meta?.content;
    if (meta) meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
    // iOS Safari ignores user-scalable=no; its gesture events can still be cancelled.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => {
      if (meta && before) meta.content = before;
      document.removeEventListener("gesturestart", stop);
    };
  }, []);
}

export interface PanZoom {
  /** Current scale (1 = fit). */
  scale(): number;
  reset(): void;
  /** True if the last touch was a drag/pinch, so the click that follows isn't a tap. */
  consumeGesture(): boolean;
}

/**
 * Pinch-zoom and drag for one page that fits the viewport (paged comics):
 * two fingers zoom around their midpoint, one finger drags when zoomed,
 * one-finger horizontal swipes at normal size call `onSwipe`. Ctrl+wheel / trackpad pinch
 * zooms on desktop, the wheel pans when zoomed.
 */
export function usePanZoom(
  viewportRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  opts: {
    enabled: boolean;
    maxScale?: number;
    /** Start pages at full width (scroll down to read) instead of fitting the whole page. */
    fitWidth?: () => boolean;
    onSwipe?: (dir: 1 | -1) => void;
    onGesture?: () => void;
  },
): PanZoom {
  const t = useRef({ s: 1, x: 0, y: 0 });
  const gesture = useRef(false);
  const o = useRef(opts);
  o.current = opts;

  const apply = () => {
    const el = contentRef.current;
    if (!el) return;
    // At normal size there's nothing to move (rounding can leave sub-pixel offsets).
    if (t.current.s <= 1.001) t.current = { s: 1, x: 0, y: 0 };
    const { s, x, y } = t.current;
    el.style.transformOrigin = "0 0";
    el.style.transform = s === 1 ? "" : `translate(${x}px, ${y}px) scale(${s})`;
  };

  /** Keep the zoomed page covering the screen (or centered when smaller). */
  const clampPan = () => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    if (!vp || !el) return;
    const { s } = t.current;
    const fit = (size: number, view: number, offset: number, v: number) => {
      const scaled = size * s;
      return scaled <= view ? (view - scaled) / 2 - offset : clamp(v, view - scaled - offset, -offset);
    };
    t.current.x = fit(el.offsetWidth, vp.clientWidth, el.offsetLeft, t.current.x);
    t.current.y = fit(el.offsetHeight, vp.clientHeight, el.offsetTop, t.current.y);
  };

  /** Scale by `k` around the viewport point (px, py). */
  const zoomAt = (k: number, px: number, py: number, base = t.current) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const s = clamp(base.s * k, 1, o.current.maxScale ?? 5);
    const lx = px - vp.left;
    const ly = py - vp.top;
    const el = contentRef.current!;
    // Content point under (px, py) stays under it.
    const cx = (lx - el.offsetLeft - base.x) / base.s;
    const cy = (ly - el.offsetTop - base.y) / base.s;
    t.current = { s, x: lx - el.offsetLeft - cx * s, y: ly - el.offsetTop - cy * s };
    if (s === 1) t.current = { s: 1, x: 0, y: 0 };
    clampPan();
    apply();
  };

  /** Starting view: whole page, or full width at the top (landscape). */
  const toBase = () => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    t.current = { s: 1, x: 0, y: 0 };
    if (vp && el && el.offsetWidth && o.current.fitWidth?.()) {
      const s = vp.clientWidth / el.offsetWidth;
      if (s > 1.05) t.current = { s, x: -el.offsetLeft, y: -el.offsetTop };
    }
    clampPan();
    apply();
  };
  /** The page can't move sideways (it fits the width), so a sideways swipe turns the page. */
  const fitsWidth = () => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    return !vp || !el || el.offsetWidth * t.current.s <= vp.clientWidth + 2;
  };

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !opts.enabled) return;
    let start: { s: number; x: number; y: number; d: number; mx: number; my: number; t: number; tx: number; ty: number } | null = null;
    // Orientation change: back to the starting view for the new shape.
    let lastW = vp.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(vp.clientWidth - lastW) > 40) toBase();
      lastW = vp.clientWidth;
    });
    ro.observe(vp);

    const onStart = (e: TouchEvent) => {
      gesture.current = false;
      const [a, b] = [e.touches[0], e.touches[1]];
      const m = b ? mid(a, b) : { x: a.clientX, y: a.clientY };
      start = { ...t.current, d: b ? dist(a, b) : 0, mx: m.x, my: m.y, t: Date.now(), tx: a.clientX, ty: a.clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      if (b) {
        e.preventDefault();
        if (!start.d) start = { ...start, ...t.current, d: dist(a, b), mx: mid(a, b).x, my: mid(a, b).y };
        const m = mid(a, b);
        gesture.current = true;
        zoomAt(dist(a, b) / start.d, start.mx, start.my, { s: start.s, x: start.x, y: start.y });
        // Two-finger drag pans too.
        t.current.x += m.x - start.mx;
        t.current.y += m.y - start.my;
        clampPan();
        apply();
        o.current.onGesture?.();
        return;
      }
      const dx = a.clientX - start.tx;
      const dy = a.clientY - start.ty;
      if (Math.hypot(dx, dy) > MIN_MOVE) gesture.current = true;
      if (t.current.s > 1) {
        e.preventDefault();
        t.current.x = start.x + dx;
        t.current.y = start.y + dy;
        clampPan();
        apply();
        o.current.onGesture?.();
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const a = e.changedTouches[0];
      if (e.touches.length === 0 && start.d === 0 && a && fitsWidth()) {
        const dx = a.clientX - start.tx;
        const dy = a.clientY - start.ty;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dy) < Math.max(60, Math.abs(dx) * 0.6) && Date.now() - start.t < 700) {
          gesture.current = true;
          o.current.onSwipe?.(dx < 0 ? 1 : -1);
        }
      }
      if (e.touches.length === 0) {
        if (t.current.s < 1.05) t.current = { s: 1, x: 0, y: 0 };
        clampPan();
        apply();
        start = null;
      } else if (e.touches.length === 1) {
        // One finger lifted after a pinch: continue as a drag from here.
        const r = e.touches[0];
        start = { ...t.current, d: 0, mx: r.clientX, my: r.clientY, t: Date.now(), tx: r.clientX, ty: r.clientY };
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
        o.current.onGesture?.();
      } else if (t.current.s > 1) {
        e.preventDefault();
        t.current.x -= e.deltaX;
        t.current.y -= e.deltaY;
        clampPan();
        apply();
        o.current.onGesture?.();
      }
    };
    vp.addEventListener("touchstart", onStart, { passive: true });
    vp.addEventListener("touchmove", onMove, { passive: false });
    vp.addEventListener("touchend", onEnd);
    vp.addEventListener("touchcancel", onEnd);
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      vp.removeEventListener("touchstart", onStart);
      vp.removeEventListener("touchmove", onMove);
      vp.removeEventListener("touchend", onEnd);
      vp.removeEventListener("touchcancel", onEnd);
      vp.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  // Stable object: safe to use in effect dependencies.
  const api = useRef<PanZoom | null>(null);
  api.current ??= {
    scale: () => t.current.s,
    reset: toBase,
    consumeGesture: () => {
      const g = gesture.current;
      gesture.current = false;
      return g;
    },
  };
  return api.current;
}

/**
 * Pinch zoom for scrolling content whose size follows a zoom setting (PDF pages, webtoon comics).
 * While pinching, the content is scaled with a CSS transform (smooth); on release the new zoom
 * is committed with `setZoom` and the scroll position adjusted so the pinched spot stays put.
 */
export function useScrollPinch(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  zoom: number,
  setZoom: (z: number) => void,
  opts: { enabled?: boolean; min?: number; max?: number; onGesture?: () => void } = {},
): { consumeGesture(): boolean } {
  const z = useRef(zoom);
  z.current = zoom;
  const gesture = useRef(false);
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || opts.enabled === false) return;
    let start: { d: number; mx: number; my: number } | null = null;
    let k = 1;
    const bounds = (f: number) => clamp(z.current * f, o.current.min ?? 0.5, o.current.max ?? 4) / z.current;

    const onStart = (e: TouchEvent) => {
      gesture.current = false;
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const m = mid(a, b);
      start = { d: dist(a, b), mx: m.x, my: m.y };
      k = 1;
      const el = contentRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.transformOrigin = `${m.x - r.left}px ${m.y - r.top}px`;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      gesture.current = true;
      k = bounds(dist(e.touches[0], e.touches[1]) / start.d);
      if (contentRef.current) contentRef.current.style.transform = `scale(${k})`;
      o.current.onGesture?.();
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length > 0) return;
      const { mx, my } = start;
      start = null;
      const el = contentRef.current;
      if (el) el.style.transform = "";
      if (Math.abs(k - 1) < 0.02) return;
      const rect = sc.getBoundingClientRect();
      const vx = mx - rect.left;
      const vy = my - rect.top;
      const px = sc.scrollLeft + vx;
      const py = sc.scrollTop + vy;
      const ratio = k;
      setZoom(+(z.current * k).toFixed(3));
      // After the new layout, keep the pinched spot under the fingers.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          sc.scrollLeft = px * ratio - vx;
          sc.scrollTop = py * ratio - vy;
        }),
      );
    };
    sc.addEventListener("touchstart", onStart, { passive: true });
    sc.addEventListener("touchmove", onMove, { passive: false });
    sc.addEventListener("touchend", onEnd);
    sc.addEventListener("touchcancel", onEnd);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const f = bounds(Math.exp(-e.deltaY / 300));
      const rect = sc.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      const px = sc.scrollLeft + vx;
      const py = sc.scrollTop + vy;
      setZoom(+(z.current * f).toFixed(3));
      requestAnimationFrame(() => {
        sc.scrollLeft = px * f - vx;
        sc.scrollTop = py * f - vy;
      });
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sc.removeEventListener("touchstart", onStart);
      sc.removeEventListener("touchmove", onMove);
      sc.removeEventListener("touchend", onEnd);
      sc.removeEventListener("touchcancel", onEnd);
      sc.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  const api = useRef<{ consumeGesture(): boolean } | null>(null);
  api.current ??= {
    consumeGesture: () => {
      const g = gesture.current;
      gesture.current = false;
      return g;
    },
  };
  return api.current;
}
