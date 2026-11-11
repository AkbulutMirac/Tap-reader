import DOMPurify from "dompurify";
import type { FoliateBook, FoliateSection, FoliateTocItem } from "foliate-js/view.js";
import { extensionOf } from "../../library/books";
import { decodeText, docxToHtml, htmlFileToHtml, markdownToHtml, odtToHtml, rtfToText, textToHtml } from "./convert";

/** Split long documents into sections of about this many characters (keeps pages fast). */
const SECTION_CHARS = 60_000;

const BASE_CSS = `
  body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; margin: 0; overflow-wrap: break-word; }
  img, svg, video { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #8884; padding: 4px 6px; }
  pre { white-space: pre-wrap; }
  h1, h2, h3 { line-height: 1.25; }
  figure { margin: 1em 0; }
`;

/** Convert any supported document file to sanitized HTML. */
export async function documentToHtml(file: Blob, fileName: string): Promise<{ html: string; title?: string }> {
  const ext = extensionOf(fileName);
  const buf = await file.arrayBuffer();
  let html: string;
  let title: string | undefined;
  switch (ext) {
    case "docx":
      html = await docxToHtml(buf);
      break;
    case "md":
    case "markdown":
      html = await markdownToHtml(decodeText(buf));
      break;
    case "html":
    case "htm":
    case "xhtml":
      ({ html, title } = htmlFileToHtml(decodeText(buf)));
      break;
    case "rtf":
      html = textToHtml(rtfToText(decodeText(buf)));
      break;
    case "odt":
      html = await odtToHtml(file);
      break;
    default:
      html = textToHtml(decodeText(buf));
  }
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
  return { html: clean, title };
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Wrap sanitized HTML in the foliate-js "book" interface: sections (split at headings when
 * long), a table of contents from h1–h3, and in-document links.
 */
export function htmlToBook(html: string, title: string): FoliateBook {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks = Array.from(doc.body.children);

  // Give headings ids for the table of contents.
  let n = 0;
  for (const h of Array.from(doc.body.querySelectorAll("h1, h2, h3"))) if (!h.id) h.id = `h-${++n}`;

  // Group top-level blocks into sections, preferring to break before a heading.
  const groups: Element[][] = [[]];
  let size = 0;
  for (const el of blocks) {
    const len = el.outerHTML.length;
    const isHeading = /^H[1-3]$/.test(el.tagName);
    if (size > 0 && (size + len > SECTION_CHARS * 1.5 || (isHeading && size > SECTION_CHARS))) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(el);
    size += len;
  }

  const idToSection = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((el) => el.querySelectorAll("[id]").forEach((x) => idToSection.set(x.id, i))));
  groups.forEach((g, i) => g.forEach((el) => el.id && idToSection.set(el.id, i)));

  const urls: (string | undefined)[] = [];
  const sectionHtml = groups.map(
    (g) =>
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeAttr(title)}</title>` +
      `<style>${BASE_CSS}</style></head><body>${g.map((el) => el.outerHTML).join("\n")}</body></html>`,
  );

  const sections: FoliateSection[] = sectionHtml.map((markup, i) => ({
    id: i,
    size: markup.length,
    linear: "yes",
    load: () => (urls[i] ??= URL.createObjectURL(new Blob([markup], { type: "text/html" }))),
    unload: () => {
      if (urls[i]) URL.revokeObjectURL(urls[i]!);
      urls[i] = undefined;
    },
    createDocument: () => new DOMParser().parseFromString(markup, "text/html"),
    resolveHref: (href) => (href.startsWith("#") ? `${idToSection.get(href.slice(1)) ?? i}${href}` : href),
  }));

  // Nested TOC from heading levels.
  const toc: FoliateTocItem[] = [];
  const stack: { level: number; item: FoliateTocItem }[] = [];
  for (const h of Array.from(doc.body.querySelectorAll("h1, h2, h3"))) {
    const label = h.textContent?.replace(/\s+/g, " ").trim();
    if (!label) continue;
    const level = Number(h.tagName[1]);
    const item: FoliateTocItem = { label, href: `${idToSection.get(h.id) ?? 0}#${h.id}`, subitems: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    (stack.length ? stack[stack.length - 1].item.subitems! : toc).push(item);
    stack.push({ level, item });
  }

  const split = (href: string): [number, string | undefined] => {
    const [index, id] = href.split("#");
    return [Number(index) || 0, id];
  };

  return {
    sections,
    dir: "ltr",
    toc,
    metadata: { title, language: "en" },
    rendition: {},
    resolveHref(href) {
      const [index, id] = split(href);
      return { index, anchor: (d: Document) => (id ? d.getElementById(id) : null) };
    },
    isExternal: (href) => /^[a-z][a-z0-9+.-]*:/i.test(href),
    splitTOCHref: (href) => split(href),
    getTOCFragment: (d, id) => (id ? d.getElementById(String(id)) : d.body),
  };
}
