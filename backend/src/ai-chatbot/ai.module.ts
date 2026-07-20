import { Module } from '@nestjs/common';
import { AiController } from './ai.controllers';
import { AiService } from './ai.services';
import { EmbeddingsService } from './embeddings.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [AiController],
  providers: [AiService, EmbeddingsService, KnowledgeBaseService, PrismaService],
})
export class AiModule {}
