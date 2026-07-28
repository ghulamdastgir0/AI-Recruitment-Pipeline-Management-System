import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
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
export class InterviewGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(InterviewGateway.name);
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
      // Remembered so a later disconnect (refresh, tab close, network
      // loss) knows which session to force-submit — see handleDisconnect.
      (client.data as { applicationId?: string }).applicationId =
        body.applicationId;
      client.emit('question', turn);
    } catch (error) {
      client.emit('error', { message: errorMessage(error) });
    }
  }

  /**
   * Ends the interview the instant the live connection drops, for any
   * reason — refresh, tab close, or network loss — rather than relying
   * solely on the client-side sendBeacon (unloadHandler.ts). A refresh
   * tears down this socket and opens a brand-new one fast enough that the
   * beacon's separate HTTP POST can race it: the refreshed page could
   * rejoin the still-"IN_PROGRESS" session before the beacon's
   * BROWSER_CLOSED report is even processed. This handler runs synchronously
   * with the disconnect itself, so there's no race — once the connection is
   * gone, the interview is over. Deliberately no reconnect grace period: a
   * dropped connection (of any cause) always ends the interview, which is
   * the whole point of "refreshing must submit". forceSubmit() is a no-op
   * if the session already finished, so this is always safe to call, and
   * still lands alongside whatever the beacon separately reports (which
   * additionally records the BROWSER_CLOSED violation row for the audit
   * trail — this handler only forces completion, it doesn't log a
   * violation itself).
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const applicationId = (client.data as { applicationId?: string })
      .applicationId;
    if (!applicationId) return;
    try {
      await this.sessions.forceSubmit(
        applicationId,
        'AUTO_SUBMITTED_BROWSER_CLOSED',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to force-submit application ${applicationId} on disconnect: ${errorMessage(error)}`,
      );
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
