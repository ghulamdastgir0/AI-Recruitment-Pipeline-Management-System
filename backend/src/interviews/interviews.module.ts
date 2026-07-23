import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AudioModule } from '../shared/audio/audio.module';
import { InterviewGateway } from './interview.gateway';
import { InterviewSessionsController } from './interview-sessions.controller';
import { InterviewTranscriptController } from './interview-transcript.controller';
import { InterviewOrchestratorService } from './services/interview-orchestrator.service';
import { InterviewReminderService } from './services/interview-reminder.service';
import { InterviewSessionService } from './services/interview-session.service';

@Module({
  imports: [
    // Local (not global) — interview-sessions is public/unauthenticated like
    // CandidatesModule, so rate-limiting stays scoped here.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    AudioModule,
  ],
  controllers: [InterviewSessionsController, InterviewTranscriptController],
  providers: [
    InterviewSessionService,
    InterviewOrchestratorService,
    InterviewGateway,
    InterviewReminderService,
  ],
  exports: [InterviewSessionService],
})
export class InterviewsModule {}
