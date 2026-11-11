/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Content-Security-Policy. Besides normal hardening it blocks scripts inside e-books:
 * book pages render in blob: iframes, which inherit this policy (see foliate-js README).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://translate.googleapis.com https://api.mymemory.translated.net",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline' blob:",
  "font-src 'self' data: blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Writes Cloudflare Pages' `_headers` file (security headers + caching) into the build. */
function cloudflareHeaders(): Plugin {
  return {
    name: "cloudflare-headers",
    apply: "build",
    generateBundle() {
      const security = Object.entries(SECURITY_HEADERS)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n");
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          `/*\n${security}`,
          `/assets/*\n  Cache-Control: public, max-age=31536000, immutable`,
          `/dict/*\n  Cache-Control: public, max-age=604800`,
          `/vendor/*\n  Cache-Control: public, max-age=604800`,
          "",
        ].join("\n"),
      });
    },
  };
}

const BOOK_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/epub+zip": [".epub"],
  "application/x-mobipocket-ebook": [".mobi", ".azw", ".azw3"],
  "application/x-fictionbook+xml": [".fb2"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/rtf": [".rtf"],
  "application/vnd.comicbook+zip": [".cbz"],
  "application/vnd.comicbook-rar": [".cbr"],
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflareHeaders(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "TapReader — tap any word to translate",
        short_name: "TapReader",
        description: "Read PDFs, e-books, documents and comics. Tap any English word to see its Turkish meaning.",
        lang: "en",
        theme_color: "#1d4ed8",
        background_color: "#f7f7f8",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        file_handlers: [{ action: ".", accept: BOOK_TYPES }],
      },
      workbox: {
        // .mjs: the pdf.js worker.
        globPatterns: ["**/*.{js,mjs,css,html,png,svg,webmanifest}"],
        globIgnores: ["vendor/**", "dict/**", "samples/**", "icons/maskable-512.png"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/dict/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "dict", expiration: { maxEntries: 800 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/vendor/") || url.pathname.includes("/samples/"),
            handler: "CacheFirst",
            options: { cacheName: "vendor", expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
  preview: { headers: SECURITY_HEADERS },
  test: {
    environment: "jsdom",
  },
});
