import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AudioModule } from '../shared/audio/audio.module';
import { InterviewSessionsController } from './interview-sessions.controller';
import { InterviewTranscriptController } from './interview-transcript.controller';
import { InterviewOrchestratorService } from './services/interview-orchestrator.service';
import { InterviewSessionService } from './services/interview-session.service';

@Module({
  imports: [
    // Local (not global) — interview-sessions is public/unauthenticated like
    // CandidatesModule, so rate-limiting stays scoped here.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    AudioModule,
  ],
  controllers: [InterviewSessionsController, InterviewTranscriptController],
  providers: [InterviewSessionService, InterviewOrchestratorService],
  exports: [InterviewSessionService],
})
export class InterviewsModule {}
