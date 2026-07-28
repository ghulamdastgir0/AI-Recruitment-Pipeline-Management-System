import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import { memoryStorage } from 'multer';
import {
  InterviewResultView,
  InterviewSessionService,
  InterviewStatusView,
  InterviewTurnView,
  LogViolationResult,
  ViolationSummary,
} from './services/interview-session.service';
// Type-only: emitDecoratorMetadata requires this split so `type!:
// ViolationType` below doesn't need a real (value) import.
import type { ViolationType } from './services/interview-session.service';

const VIOLATION_TYPES: ViolationType[] = [
  'FACE_MISSING',
  'MULTIPLE_FACES',
  'LOOKING_AWAY',
  'MOBILE_DETECTED',
  'TAB_SWITCH',
  'FULLSCREEN_EXIT',
  'WINDOW_BLUR',
  'CAMERA_DISABLED',
  'MICROPHONE_DISABLED',
  'BROWSER_CLOSED',
  'SHORTCUT_ATTEMPTED',
];

// The global ValidationPipe runs with { whitelist: true, forbidNonWhitelisted:
// true } (see main.ts) — any body property without a class-validator
// decorator gets the WHOLE request rejected with a 400, not just stripped.
// Every field here needs a decorator or this endpoint silently 400s on
// every call.
class ReportViolationDto {
  @ApiProperty({ enum: VIOLATION_TYPES })
  @IsIn(VIOLATION_TYPES)
  type!: ViolationType;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

const MAX_ANSWER_AUDIO_BYTES = 10 * 1024 * 1024;

const audioFileValidationPipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^audio\// })
  .addMaxSizeValidator({ maxSize: MAX_ANSWER_AUDIO_BYTES })
  .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Public, unauthenticated candidate side of the AI technical interview — no
 * candidate accounts/login exist anywhere in this system (same reasoning as
 * CandidatesController). The candidate's applicationId (returned from CV
 * upload) is their reference; there's nothing else to authenticate against.
 * Turn-based over plain REST (one HTTP round trip per question) since no
 * frontend/websocket infra exists yet — swap to real-time streaming once one
 * does.
 */
@ApiTags('interview-sessions')
@Controller('interview-sessions')
export class InterviewSessionsController {
  constructor(private readonly sessions: InterviewSessionService) {}

  @Post(':applicationId/start')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Start (or resume) your AI technical interview. No authentication required.',
  })
  async start(
    @Param('applicationId') applicationId: string,
  ): Promise<InterviewTurnView> {
    return this.sessions.start(applicationId);
  }

  @Post(':applicationId/answer')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Submit a recorded audio answer to the current question. Returns the next question, or the final result once the interview is complete. No authentication required.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ANSWER_AUDIO_BYTES },
    }),
  )
  async answer(
    @Param('applicationId') applicationId: string,
    @UploadedFile(audioFileValidationPipe) file: Express.Multer.File,
    @Body('questionId') questionId?: string,
  ): Promise<InterviewTurnView | InterviewResultView> {
    return this.sessions.answer(applicationId, file, questionId);
  }

  @Get(':applicationId/status')
  @UseGuards(ThrottlerGuard)
  // The frontend polls this every few seconds while an application is
  // pending/in-progress — needs real headroom above a single candidate's
  // sustained poll rate, not just occasional-check levels like the other
  // endpoints here.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Check your application/interview status. No authentication required. Never exposes your CV match score — only interview results after you complete it.',
  })
  async status(
    @Param('applicationId') applicationId: string,
  ): Promise<InterviewStatusView> {
    return this.sessions.getStatus(applicationId);
  }

  @Post(':applicationId/violations')
  @UseGuards(ThrottlerGuard)
  // Generous relative to the other endpoints — this is the target for the
  // proctoring loop's periodic reports plus the beforeunload sendBeacon
  // ping, so it needs headroom above a single interview's occasional-check
  // rate without being a spend risk (it triggers no LLM/Groq calls).
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Report one proctoring irregularity (face missing, phone detected, tab switch, etc.) for a live interview. No authentication required. Auto-submits the interview once warnings reach the cap, or immediately for a browser-close report.',
  })
  async reportViolation(
    @Param('applicationId') applicationId: string,
    @Body() body: ReportViolationDto,
  ): Promise<LogViolationResult> {
    return this.sessions.logViolation(applicationId, body.type, body.metadata);
  }

  @Get(':applicationId/violations')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Current violation counts and risk level for this interview. No authentication required — used to restore the warning count after a page refresh.',
  })
  async violations(
    @Param('applicationId') applicationId: string,
  ): Promise<ViolationSummary> {
    return this.sessions.getViolationSummary(applicationId);
  }

  @Get('questions/:questionId/audio')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Download the spoken audio for an interview question.',
  })
  async questionAudio(
    @Param('questionId') questionId: string,
  ): Promise<StreamableFile> {
    const buffer = await this.sessions.getQuestionAudio(questionId);
    return new StreamableFile(buffer, { type: 'audio/wav' });
  }
}
