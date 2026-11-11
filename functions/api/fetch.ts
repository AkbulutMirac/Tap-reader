// GET /api/fetch?url=https://… — returns that web page's HTML so the app can extract the
// article (browsers can't read other sites directly because of CORS).
// Runs as a Cloudflare Pages Function in production and as Vite middleware in development.
// Limits: same-origin callers only, http(s) only, public hosts only, HTML only, 5 MB, 15 s.

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 15_000;
const UA = "Mozilla/5.0 (compatible; TapReader/1.0; +https://github.com/) AppleWebKit/537.36 (KHTML, like Gecko)";

const reply = (status: number, message: string) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** Hosts that point at the local machine or a private network. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
  return false;
}

export async function handleFetch(request: Request): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return reply(403, "Not allowed.");

  const target = new URL(request.url).searchParams.get("url");
  let url: URL;
  try {
    url = new URL(target ?? "");
  } catch {
    return reply(400, "That doesn't look like a link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return reply(400, "Only http(s) links can be opened.");
  if (isPrivateHost(url.hostname)) return reply(400, "That address can't be opened.");

  let res: Response;
  try {
    res = await fetch(url.href, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return reply(502, "Couldn't reach that site.");
  }
  if (!res.ok) return reply(502, `The site answered with an error (HTTP ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) return reply(415, "That link isn't a web page.");

  // Read at most MAX_BYTES.
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return reply(413, "That page is too large.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-final-url": res.url || url.href,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const onRequestGet = ({ request }: { request: Request }) => handleFetch(request);
