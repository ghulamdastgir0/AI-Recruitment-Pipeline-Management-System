import { Module } from '@nestjs/common';
import { CandidatesModule } from '../candidates/candidates.module';
import { DocumentsModule } from '../documents/documents.module';
import { JobPostingsModule } from '../job-postings/job-postings.module';
import { MatchingModule } from '../matching/matching.module';
import { UsersModule } from '../users/users.module';
import { AssistantController } from './assistant.controller';
import { AssistantOrchestratorService } from './assistant-orchestrator.service';
import { PendingActionSweepService } from './pending-action-sweep.service';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [
    DocumentsModule,
    JobPostingsModule,
    CandidatesModule,
    MatchingModule,
    UsersModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantOrchestratorService,
    ToolRegistryService,
    PendingActionSweepService,
  ],
})
export class AssistantModule {}
