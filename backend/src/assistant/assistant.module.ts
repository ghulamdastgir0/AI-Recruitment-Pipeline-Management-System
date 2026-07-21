import { Module } from '@nestjs/common';
import { CandidatesModule } from '../candidates/candidates.module';
import { DocumentsModule } from '../documents/documents.module';
import { JobPostingsModule } from '../job-postings/job-postings.module';
import { MatchingModule } from '../matching/matching.module';
import { AssistantController } from './assistant.controller';
import { AssistantOrchestratorService } from './assistant-orchestrator.service';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [
    DocumentsModule,
    JobPostingsModule,
    CandidatesModule,
    MatchingModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantOrchestratorService, ToolRegistryService],
})
export class AssistantModule {}
