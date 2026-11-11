import { useSyncExternalStore } from "react";

/** App screens, kept in the URL hash so the back button and reloads work. */
export type Route =
  | { name: "library" }
  | { name: "read"; bookId: string }
  | { name: "words" }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const [, screen, arg] = hash.replace(/^#/, "").split("/");
  if (screen === "read" && arg) return { name: "read", bookId: decodeURIComponent(arg) };
  if (screen === "words") return { name: "words" };
  if (screen === "settings") return { name: "settings" };
  return { name: "library" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "read":
      return `#/read/${encodeURIComponent(route.bookId)}`;
    case "library":
      return "#/";
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, replace = false): void {
  const url = href(route);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => location.hash,
  );
  return parseRoute(hash);
}
