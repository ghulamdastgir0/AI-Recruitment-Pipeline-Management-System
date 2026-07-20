import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EmbeddingsService } from './embeddings.service';
import { KNOWLEDGE_BASE_SEED } from './knowledge-base-seed';
import { PrismaService } from './prisma.service';

export interface RetrievedChunk {
  title: string;
  content: string;
  similarity: number;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async seed(): Promise<{ inserted: number }> {
    await this.prisma.$executeRaw`DELETE FROM "KnowledgeDocument"`;

    let inserted = 0;
    for (const { title, sourceType, content } of KNOWLEDGE_BASE_SEED) {
      const embedding = await this.embeddings.embed(`${title}\n\n${content}`);
      const vectorLiteral = `[${embedding.join(',')}]`;

      await this.prisma.$executeRaw`
        INSERT INTO "KnowledgeDocument" (id, title, "sourceType", content, embedding, "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${title}, ${sourceType}::"KnowledgeSourceType", ${content}, ${vectorLiteral}::vector, now(), now())
      `;
      inserted += 1;
      this.logger.log(`Embedded and stored: ${title}`);
    }

    return { inserted };
  }

  async retrieve(query: string, limit = 6): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embeddings.embed(query);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    return this.prisma.$queryRaw<RetrievedChunk[]>`
      SELECT title, content, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM "KnowledgeDocument"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
}
