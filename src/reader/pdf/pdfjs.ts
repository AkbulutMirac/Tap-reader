import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}vendor/pdfjs/`;

export function openPdf(data: ArrayBuffer) {
  return pdfjs.getDocument({
    // pdf.js takes ownership of (detaches) the buffer it's given, so pass a copy.
    data: new Uint8Array(data.slice(0)),
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
  });
}

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
