import { Module } from '@nestjs/common';
import { CandidateCommentsModule } from '../candidate-comments/candidate-comments.module';
import { CandidatesModule } from '../candidates/candidates.module';
import { DocumentsModule } from '../documents/documents.module';
import { HiringDecisionsModule } from '../hiring-decisions/hiring-decisions.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { JobPostingsModule } from '../job-postings/job-postings.module';
import { MatchingModule } from '../matching/matching.module';
import { UsersModule } from '../users/users.module';
import { AssistantController } from './assistant.controller';
import { AssistantAgentGraph } from './assistant-agent.graph';
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
    CandidateCommentsModule,
    HiringDecisionsModule,
    InterviewsModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantOrchestratorService,
    AssistantAgentGraph,
    ToolRegistryService,
    PendingActionSweepService,
  ],
})
export class AssistantModule {}
