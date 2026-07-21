import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from '../../shared/embeddings/embeddings.service';

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  pageNumber: number;
  chunkIndex: number;
  createdAt: Date;
  documentId: string;
  documentName: string;
  version: number;
  status: string;
  similarity: number;
}

const DEFAULT_LIMIT = 6;

/**
 * Query-time retrieval only: embeds the question and searches previously
 * stored chunks. Never uploads, extracts, or (re-)embeds a document — that
 * happens exactly once, at upload time, in DocumentProcessorService.
 */
@Injectable()
export class DocumentRetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async retrieve(
    query: string,
    limit = DEFAULT_LIMIT,
  ): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embeddings.embed(query);
    const vectorLiteral = this.embeddings.toVectorLiteral(queryEmbedding);

    // status = 'ACTIVE' is the only gate that matters here: it excludes
    // PROCESSING/FAILED versions and every superseded (INACTIVE) version,
    // so the chatbot only ever sees the single latest active version.
    return this.prisma.$queryRaw<RetrievedChunk[]>`
      SELECT
        dc.id AS "chunkId",
        dc.content AS content,
        dc."pageNumber" AS "pageNumber",
        dc."chunkIndex" AS "chunkIndex",
        dc."createdAt" AS "createdAt",
        d.id AS "documentId",
        d.name AS "documentName",
        d.version AS version,
        d.status AS status,
        1 - (dc.embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM "DocumentChunk" dc
      JOIN "Document" d ON d.id = dc."documentId"
      WHERE d.status = 'ACTIVE' AND dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
}
