import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai-chatbot/ai.module';
import { AssistantModule } from './assistant/assistant.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CandidatesModule } from './candidates/candidates.module';
import { JobPostingsModule } from './job-postings/job-postings.module';
import { MatchingModule } from './matching/matching.module';
import { PrismaModule } from './prisma/prisma.module';
import { BackgroundJobsModule } from './shared/background-jobs/background-jobs.module';
import { EmbeddingsModule } from './shared/embeddings/embeddings.module';
import { LlmClientModule } from './shared/llm/llm-client.module';
import { PdfModule } from './shared/pdf/pdf.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmbeddingsModule,
    LlmClientModule,
    BackgroundJobsModule,
    PdfModule,
    AuditModule,
    AuthModule,
    AiModule,
    JobPostingsModule,
    CandidatesModule,
    MatchingModule,
    AssistantModule,
  ],
})
export class AppModule {}
