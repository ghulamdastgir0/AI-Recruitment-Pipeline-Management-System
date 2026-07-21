import { Injectable } from '@nestjs/common';
import type { ExtractedPage } from '../../shared/pdf/pdf-text-extractor.service';

export interface TextChunk {
  pageNumber: number;
  chunkIndex: number;
  content: string;
}

const DEFAULT_MAX_CHARS = 1000;
const DEFAULT_OVERLAP_CHARS = 150;

/** Splits per-page extracted text into overlapping, word-boundary-safe chunks for embedding. */
@Injectable()
export class TextChunkerService {
  chunkPages(
    pages: ExtractedPage[],
    options?: { maxChars?: number; overlapChars?: number },
  ): TextChunk[] {
    const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
    const overlapChars = options?.overlapChars ?? DEFAULT_OVERLAP_CHARS;
    const chunks: TextChunk[] = [];
    let chunkIndex = 0;

    for (const page of pages) {
      const normalized = page.text.replace(/\s+/g, ' ').trim();
      if (!normalized) continue;

      let start = 0;
      while (start < normalized.length) {
        let end = Math.min(start + maxChars, normalized.length);
        if (end < normalized.length) {
          const lastSpace = normalized.lastIndexOf(' ', end);
          if (lastSpace > start) end = lastSpace;
        }

        const content = normalized.slice(start, end).trim();
        if (content) {
          chunks.push({
            pageNumber: page.pageNumber,
            chunkIndex: chunkIndex++,
            content,
          });
        }

        if (end >= normalized.length) break;
        start = Math.max(end - overlapChars, start + 1);
      }
    }

    return chunks;
  }
}
