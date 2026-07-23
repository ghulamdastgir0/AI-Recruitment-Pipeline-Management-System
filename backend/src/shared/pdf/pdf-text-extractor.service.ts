import { pathToFileURL } from 'node:url';
import { Injectable } from '@nestjs/common';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

interface PdfJsTextItem {
  str?: string;
}

// pdfjs-dist ships ESM-only; loaded via dynamic import() from this CJS
// module and cached, rather than pulled in through pdf-parse's bundled
// (and years-stale) internal PDF.js, which fails on xref tables and content
// streams produced by many modern PDF generators. Shared by document and CV
// processing — both need per-page text.
let pdfjsModulePromise: Promise<
  typeof import('pdfjs-dist/legacy/build/pdf.mjs')
> | null = null;

function loadPdfjs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(
      (pdfjs) => {
        // This file compiles to CommonJS, so `require` is available natively
        // here (unlike in the ESM pdfjs-dist module itself). The worker path
        // must be a file:// URL — on Windows, Node's ESM loader rejects a
        // bare "E:\..." path with "Received protocol 'e:'".
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
          require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
        ).href;
        return pdfjs;
      },
    );
  }
  return pdfjsModulePromise;
}

// Some PDF generators (icon-heavy resume templates like enhancv.com are a
// known source) map decorative glyphs — phone/email/location icons — onto
// control code points instead of real characters. pdf.js dutifully extracts
// them as literal U+0000 etc., which Postgres then hard-rejects ("invalid
// byte sequence for encoding UTF8: 0x00") the moment that text is written to
// any text/JSON column — surfacing far downstream of the actual PDF as a
// confusing CV-processing failure. Stripped here, once, for every consumer.
const DISALLOWED_CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex -- deliberately targeting C0 control chars
  /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

export function sanitizeExtractedText(text: string): string {
  return text.replace(DISALLOWED_CONTROL_CHARS, '');
}

/** Extracts per-page text from a PDF buffer so chunks/evidence can carry an accurate page number. */
@Injectable()
export class PdfTextExtractorService {
  async extractPages(buffer: Buffer): Promise<ExtractedPage[]> {
    const pdfjs = await loadPdfjs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });

    try {
      const pdf = await loadingTask.promise;
      const pages: ExtractedPage[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        try {
          const textContent = await page.getTextContent();
          const text = sanitizeExtractedText(
            (textContent.items as PdfJsTextItem[])
              .map((item) => item.str ?? '')
              .join(' '),
          );
          pages.push({ pageNumber, text });
        } finally {
          page.cleanup();
        }
      }
      return pages;
    } finally {
      await loadingTask.destroy();
    }
  }
}
