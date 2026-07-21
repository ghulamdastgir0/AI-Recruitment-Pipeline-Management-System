import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from '../../shared/embeddings/embeddings.service';
import { FileStorageService } from './file-storage.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { TextChunkerService } from './text-chunker.service';

/**
 * Runs the extract -> chunk -> embed pipeline for a single Document row,
 * exactly once, off the HTTP request that created it (see
 * BackgroundJobQueueService). Only flips the document to ACTIVE — and only
 * then retires the previous ACTIVE version of the same name — once every
 * chunk has been embedded and stored, so a bad upload never leaves the
 * chatbot without a usable active version.
 */
@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly pdfExtractor: PdfTextExtractorService,
    private readonly chunker: TextChunkerService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async process(documentId: string): Promise<void> {
    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });

    try {
      const buffer = await this.storage.read(document.filePath);
      const pages = await this.pdfExtractor.extractPages(buffer);
      const chunks = this.chunker.chunkPages(pages);

      if (chunks.length === 0) {
        throw new Error(
          'No extractable text found in this PDF (it may be a scanned image without a text layer).',
        );
      }

      for (const chunk of chunks) {
        const embedding = await this.embeddings.embed(chunk.content);
        const vectorLiteral = this.embeddings.toVectorLiteral(embedding);

        await this.prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", content, embedding, "pageNumber", "chunkIndex", "createdAt")
          VALUES (${randomUUID()}, ${documentId}, ${chunk.content}, ${vectorLiteral}::vector, ${chunk.pageNumber}, ${chunk.chunkIndex}, now())
        `;
      }

      // Cut over atomically: the new version only becomes ACTIVE, and prior
      // ACTIVE version(s) of this document name only retire, in the same
      // transaction — retrieval never sees zero or two active versions.
      await this.prisma.$transaction([
        this.prisma.document.updateMany({
          where: {
            name: document.name,
            status: 'ACTIVE',
            NOT: { id: documentId },
          },
          data: { status: 'INACTIVE' },
        }),
        this.prisma.document.update({
          where: { id: documentId },
          data: { status: 'ACTIVE', processingError: null },
        }),
      ]);

      this.logger.log(
        `Processed document ${documentId} (${document.name} v${document.version}): ${chunks.length} chunks embedded and activated.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Processing failed for document ${documentId} (${document.name} v${document.version}): ${message}`,
      );
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED', processingError: message },
      });
    }
  }
}
