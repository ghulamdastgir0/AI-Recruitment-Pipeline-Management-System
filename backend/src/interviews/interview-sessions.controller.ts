import {
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
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import {
  InterviewResultView,
  InterviewSessionService,
  InterviewStatusView,
  InterviewTurnView,
} from './services/interview-session.service';

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
  ): Promise<InterviewTurnView | InterviewResultView> {
    return this.sessions.answer(applicationId, file);
  }

  @Get(':applicationId/status')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Check your application/interview status. No authentication required. Never exposes your CV match score — only interview results after you complete it.',
  })
  async status(
    @Param('applicationId') applicationId: string,
  ): Promise<InterviewStatusView> {
    return this.sessions.getStatus(applicationId);
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
