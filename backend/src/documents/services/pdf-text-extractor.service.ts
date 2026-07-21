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
// streams produced by many modern PDF generators.
let pdfjsModulePromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

function loadPdfjs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      // This file compiles to CommonJS, so `require` is available natively
      // here (unlike in the ESM pdfjs-dist module itself). The worker path
      // must be a file:// URL — on Windows, Node's ESM loader rejects a
      // bare "E:\..." path with "Received protocol 'e:'".
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ).href;
      return pdfjs;
    });
  }
  return pdfjsModulePromise;
}

/** Extracts per-page text from a PDF buffer so chunks can carry an accurate page number. */
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
          const text = (textContent.items as PdfJsTextItem[]).map((item) => item.str ?? '').join(' ');
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
