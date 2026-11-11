/** Converters from document formats to (unsanitized) HTML body markup. */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Decode text as UTF-8, falling back to Windows-1252 for old files. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const HEADING = /^(chapter|part|book|section|prologue|epilogue|preface|introduction|contents)\b[\s\w.:'-]{0,60}$/i;

/**
 * Plain text → paragraphs. Hard-wrapped text (lines joined by single newlines, paragraphs by
 * blank lines, like Project Gutenberg) is re-joined; otherwise every line is a paragraph.
 */
export function textToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const blocks = normalized.split(/\n\s*\n/);
  const wrapped = blocks.length > 1;
  const out: string[] = [];
  for (const block of wrapped ? blocks : normalized.split("\n")) {
    const lines = block.split("\n").map((l) => l.trim());
    const joined = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!joined) continue;
    const isHeading =
      lines.length <= 2 && joined.length < 70 && (HEADING.test(joined) || (/^[^a-z]*[A-Z][^a-z]*$/.test(joined) && joined.length > 3));
    out.push(isHeading ? `<h2>${escapeHtml(joined)}</h2>` : `<p>${escapeHtml(joined)}</p>`);
  }
  return out.join("\n");
}

export async function markdownToHtml(md: string): Promise<string> {
  const { marked } = await import("marked");
  return marked.parse(md, { async: false, gfm: true }) as string;
}

export async function docxToHtml(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  return result.value;
}

/** The <body> content of an HTML file (scripts are removed later by the sanitizer). */
export function htmlFileToHtml(text: string): { html: string; title?: string } {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return { html: doc.body?.innerHTML ?? "", title: doc.title || undefined };
}

/** OpenDocument text (.odt): read content.xml and map paragraphs, headings and lists. */
export async function odtToHtml(blob: Blob): Promise<string> {
  const { configure, ZipReader, BlobReader, TextWriter } = await import("foliate-js/vendor/zip.js");
  configure({ useWebWorkers: false });
  const zip = new ZipReader(new BlobReader(blob));
  const entries = await zip.getEntries();
  const content = entries.find((e) => e.filename === "content.xml");
  if (!content) throw new Error("Not an OpenDocument text file");
  const xml = new DOMParser().parseFromString(await content.getData<string>(new TextWriter()), "application/xml");
  await zip.close();

  const walk = (node: Node): string => {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += escapeHtml(child.textContent ?? "");
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      switch (el.localName) {
        case "h": {
          const level = Math.min(6, Math.max(1, Number(el.getAttribute("text:outline-level")) || 2));
          out += `<h${level}>${walk(el)}</h${level}>`;
          break;
        }
        case "p":
          out += `<p>${walk(el)}</p>`;
          break;
        case "list":
          out += `<ul>${walk(el)}</ul>`;
          break;
        case "list-item":
          out += `<li>${walk(el)}</li>`;
          break;
        case "s":
          out += " ".repeat(Number(el.getAttribute("text:c")) || 1);
          break;
        case "tab":
          out += " ";
          break;
        case "line-break":
          out += "<br>";
          break;
        case "note":
        case "annotation":
          break;
        default:
          out += walk(el);
      }
    }
    return out;
  };
  const body = xml.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:office:1.0", "text")[0];
  return body ? walk(body) : "";
}

/** Destinations (RTF groups) whose text isn't document text. */
const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "listtable", "listoverridetable", "rsidtbl", "generator", "themedata", "datastore", "latentstyles", "xmlnstbl", "object", "fldinst"]);

/** Minimal RTF reader: keeps text, paragraphs and line breaks; drops formatting. */
export function rtfToText(rtf: string): string {
  let out = "";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1; // chars to skip after \uN
  let pendingSkip = 0;
  let i = 0;
  const emit = (s: string) => {
    if (skip) return;
    if (pendingSkip > 0) {
      const n = Math.min(pendingSkip, s.length);
      pendingSkip -= n;
      s = s.slice(n);
    }
    out += s;
  };
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      stack.push({ skip, uc });
      i++;
    } else if (ch === "}") {
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
      i++;
    } else if (ch === "\\") {
      const next = rtf[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
      } else if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (!Number.isNaN(code)) emit(new TextDecoder("windows-1252").decode(new Uint8Array([code])));
        i += 4;
      } else if (next === "*") {
        skip = true;
        i += 2;
      } else if (next === "~") {
        emit(" ");
        i += 2;
      } else if (next === "\n" || next === "\r") {
        emit("\n");
        i += 2;
      } else {
        const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
        if (!m) {
          i += 2;
          continue;
        }
        const [all, word, arg] = m;
        i += all.length;
        if (RTF_SKIP.has(word)) skip = true;
        else if (word === "par" || word === "sect" || word === "page") emit("\n\n");
        else if (word === "line") emit("\n");
        else if (word === "tab") emit("\t");
        else if (word === "uc") uc = Number(arg ?? 1);
        else if (word === "u" && arg) {
          const code = Number(arg);
          emit(String.fromCharCode(code < 0 ? code + 65536 : code));
          pendingSkip = uc;
        } else if (word === "emdash") emit("—");
        else if (word === "endash") emit("–");
        else if (word === "lquote") emit("‘");
        else if (word === "rquote") emit("’");
        else if (word === "ldblquote") emit("“");
        else if (word === "rdblquote") emit("”");
        else if (word === "bullet") emit("•");
      }
    } else if (ch === "\r" || ch === "\n") {
      i++;
    } else {
      emit(ch);
      i++;
    }
  }
  return out;
}
