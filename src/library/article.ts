import { addBook } from "./books";
import type { Book } from "../db";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) links can be opened.");
  return url.href;
}

/**
 * Download a web page through the app's /api/fetch proxy (browsers block reading other sites
 * directly), keep only the article text with Readability, and add it to the library.
 */
export async function importArticle(input: string): Promise<Book> {
  const url = normalizeUrl(input);
  const res = await fetch(`${import.meta.env.BASE_URL}api/fetch?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `Couldn't load the page (HTTP ${res.status}).`);
  const finalUrl = res.headers.get("x-final-url") || url;
  const html = await res.text();

  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = doc.createElement("base");
  base.href = finalUrl;
  doc.head.prepend(base);

  const { Readability } = await import("@mozilla/readability");
  const article = new Readability(doc).parse();
  if (!article?.content || (article.textContent ?? "").trim().length < 200) {
    throw new Error("Couldn't find article text on that page.");
  }
  const title = article.title?.trim() || new URL(finalUrl).hostname;
  const page =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>` +
    `<h1>${escapeHtml(title)}</h1>` +
    (article.byline ? `<p><em>${escapeHtml(article.byline)}</em></p>` : "") +
    `<p><small>${escapeHtml(finalUrl)}</small></p>` +
    article.content +
    `</body></html>`;
  const file = new File([page], `${title.slice(0, 80)}.html`, { type: "text/html" });
  const book = await addBook(file, "article");
  return book;
}
