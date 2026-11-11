import { useEffect, useSyncExternalStore } from "react";
import { useSettings, type Theme } from "./settings";

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function useSystemDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      darkQuery?.addEventListener("change", cb);
      return () => darkQuery?.removeEventListener("change", cb);
    },
    () => darkQuery?.matches ?? false,
  );
}

export type EffectiveTheme = Exclude<Theme, "system">;

/** The theme actually shown (system resolved to light/dark). */
export function useEffectiveTheme(): EffectiveTheme {
  const { theme } = useSettings();
  const systemDark = useSystemDark();
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

/** Colors the reader pages use for each theme (also passed into e-book iframes). */
export const PAGE_COLORS: Record<EffectiveTheme, { bg: string; fg: string; link: string }> = {
  light: { bg: "#ffffff", fg: "#1c1c1e", link: "#2563eb" },
  dark: { bg: "#18181b", fg: "#e4e4e7", link: "#93c5fd" },
  sepia: { bg: "#f6efdc", fg: "#4a3b28", link: "#8a5a1f" },
};

/** Applies the theme to <html> (HeroUI reads the `dark` class / data-theme). */
export function useApplyTheme(): EffectiveTheme {
  const theme = useEffectiveTheme();
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", theme === "dark");
    html.classList.toggle("sepia", theme === "sepia");
    html.dataset.theme = theme === "dark" ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PAGE_COLORS[theme].bg);
  }, [theme]);
  return theme;
}
