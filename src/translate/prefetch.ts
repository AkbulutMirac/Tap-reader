import { useSyncExternalStore } from "react";
import type { DictMeta } from "./dictFormat";

/**
 * Downloads every dictionary file once in the background so all words work offline.
 * The service worker caches the responses; this only requests them.
 */

const KEY = "tapreader.dictReady";
const CONCURRENCY = 4;

export interface PrefetchState {
  status: "idle" | "running" | "ready" | "error";
  done: number;
  total: number;
}

let state: PrefetchState = { status: readyVersion() ? "ready" : "idle", done: 0, total: 0 };
const listeners = new Set<() => void>();
const set = (s: Partial<PrefetchState>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

function readyVersion(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function prefetchDictionary(force = false): Promise<void> {
  if (state.status === "running" || !navigator.onLine) return;
  const base = `${import.meta.env.BASE_URL}dict/`;
  try {
    const meta = (await (await fetch(`${base}meta.json`, { cache: "no-cache" })).json()) as DictMeta;
    if (!force && readyVersion() === meta.version) {
      set({ status: "ready" });
      return;
    }
    set({ status: "running", done: 0, total: meta.shards.length });
    const queue = [...meta.shards];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let name = queue.shift(); name; name = queue.shift()) {
          const res = await fetch(`${base}${name}.json`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await res.arrayBuffer();
          set({ done: state.done + 1 });
        }
      }),
    );
    try {
      localStorage.setItem(KEY, meta.version);
    } catch {
      // Without storage we'll just check again next time.
    }
    set({ status: "ready" });
  } catch {
    set({ status: "error" });
  }
}

/** Start the background download once the app is idle (only when a service worker can cache it). */
export function schedulePrefetch(): void {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then(async () => {
    // Requests are cached only once the service worker controls this page.
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        setTimeout(resolve, 15_000);
      });
    }
    if (!navigator.serviceWorker.controller) return;
    const start = () => void prefetchDictionary();
    if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 10_000 });
    else setTimeout(start, 3000);
  });
}

export function usePrefetchState(): PrefetchState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
