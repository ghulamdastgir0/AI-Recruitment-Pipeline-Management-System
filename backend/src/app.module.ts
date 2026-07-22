import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssistantModule } from './assistant/assistant.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CandidateCommentsModule } from './candidate-comments/candidate-comments.module';
import { CandidatesModule } from './candidates/candidates.module';
import { JobPostingsModule } from './job-postings/job-postings.module';
import { MatchingModule } from './matching/matching.module';
import { PrismaModule } from './prisma/prisma.module';
import { BackgroundJobsModule } from './shared/background-jobs/background-jobs.module';
import { EmbeddingsModule } from './shared/embeddings/embeddings.module';
import { LlmClientModule } from './shared/llm/llm-client.module';
import { PdfModule } from './shared/pdf/pdf.module';
import { UsersModule } from './users/users.module';

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
    JobPostingsModule,
    CandidatesModule,
    MatchingModule,
    AssistantModule,
    UsersModule,
    CandidateCommentsModule,
  ],
})
export class AppModule {}
