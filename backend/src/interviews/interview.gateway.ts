import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { InterviewSessionService } from './services/interview-session.service';

interface JoinPayload {
  applicationId: string;
}

interface AnswerPayload {
  applicationId: string;
  audio: ArrayBuffer;
  filename: string;
  /** The question this recording was made for — lets the service detect/ignore a stale timeout-retry. */
  questionId?: string;
}

// Mirrors the REST twin's @Throttle windows (interview-sessions.controller.ts)
// — ThrottlerGuard only guards HTTP routes, so the WS transport the frontend
// actually uses needs its own equivalent. Each event triggers real, billed
// Groq STT/LLM/TTS calls, so this is the only thing standing between a
// hammering client (or a retry loop) and unbounded API spend.
const JOIN_LIMIT = { max: 10, windowMs: 600_000 };
const ANSWER_LIMIT = { max: 30, windowMs: 600_000 };

class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True if this key is still within its rate limit (and records the hit). */
  consume(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (existing.length >= this.max) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}

/**
 * Real-time transport for the candidate side of the AI interview — a thin
 * event-driven wrapper over InterviewSessionService (no business logic
 * duplicated here). Push-based question delivery replaces the polling loop
 * a plain-REST client would otherwise need; the underlying Groq STT/TTS
 * calls are still single-shot request/response either way, so audio itself
 * is still recorded as one clip per turn and sent whole, not streamed live.
 * The existing REST endpoints (interview-sessions.controller.ts) stay in
 * place unchanged — this is an additional interface, not a replacement.
 */
@WebSocketGateway({
  namespace: 'interviews',
  cors: { origin: process.env.CORS_ORIGIN ?? '*' },
  // Default is 1MB — a spoken answer clip (webm/opus) is normally well under
  // that, but silence detection now allows longer uninterrupted turns than
  // the old manual stop-button flow did, so give it real headroom.
  maxHttpBufferSize: 10 * 1024 * 1024,
})
export class InterviewGateway {
  private readonly joinLimiter = new SlidingWindowLimiter(
    JOIN_LIMIT.max,
    JOIN_LIMIT.windowMs,
  );
  private readonly answerLimiter = new SlidingWindowLimiter(
    ANSWER_LIMIT.max,
    ANSWER_LIMIT.windowMs,
  );

  constructor(private readonly sessions: InterviewSessionService) {}

  @SubscribeMessage('join')
  async handleJoin(
    @MessageBody() body: JoinPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.joinLimiter.consume(body.applicationId)) {
      client.emit('error', {
        message: 'Too many attempts — please wait a few minutes and try again.',
      });
      return;
    }
    try {
      const turn = await this.sessions.start(body.applicationId);
      client.emit('question', turn);
    } catch (error) {
      client.emit('error', { message: errorMessage(error) });
    }
  }

  @SubscribeMessage('answer')
  async handleAnswer(
    @MessageBody() body: AnswerPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.answerLimiter.consume(body.applicationId)) {
      client.emit('error', {
        message: 'Too many attempts — please wait a few minutes and try again.',
      });
      return;
    }
    try {
      const result = await this.sessions.answer(
        body.applicationId,
        {
          buffer: Buffer.from(body.audio),
          originalname: body.filename,
        },
        body.questionId,
      );
      if ('status' in result) {
        client.emit('completed', result);
      } else {
        client.emit('question', result);
      }
    } catch (error) {
      client.emit('error', { message: errorMessage(error) });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
