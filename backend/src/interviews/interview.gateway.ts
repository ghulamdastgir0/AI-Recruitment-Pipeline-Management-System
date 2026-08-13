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

// How long a dropped connection gets before it's treated as final. Cloud
// Run has no guaranteed session affinity by default, cold starts under
// min-instances=0, and candidates are on ordinary home/mobile networks — a
// few seconds of WS hiccup is routine, not a candidate walking away.
const DISCONNECT_GRACE_MS = 20_000;

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
  // One pending force-submit timer per applicationId — cleared if the
  // candidate (or their auto-reconnecting Socket.IO client) rejoins within
  // the grace window. In-memory only: fine at this deployment's scale
  // (max-instances=2, and a rejoin landing on the *other* instance just
  // means the grace period didn't apply, not that anything breaks).
  private readonly pendingDisconnects = new Map<string, NodeJS.Timeout>();

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
    // Reconnecting within the grace window cancels the pending force-submit
    // from the earlier drop — sessions.start() below resumes the same
    // in-progress question on its own, so there's nothing else to redo here.
    const pendingDisconnect = this.pendingDisconnects.get(body.applicationId);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      this.pendingDisconnects.delete(body.applicationId);
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
   * Ends the interview once the live connection has been gone for
   * DISCONNECT_GRACE_MS, for any reason — refresh, tab close, or network
   * loss — rather than relying solely on the client-side sendBeacon
   * (unloadHandler.ts). A genuine refresh/close is well past the grace
   * window by the time this fires, so the race this used to guard against
   * (a refreshed page rejoining before the beacon's BROWSER_CLOSED report
   * lands) still doesn't happen in practice. What changed: a *transient*
   * drop — Cloud Run cold start, a WS proxy timeout, an ordinary WiFi/mobile
   * network hiccup — no longer nukes the interview outright. Socket.IO's
   * client auto-reconnects and re-emits 'join' on its own; handleJoin above
   * cancels this timer if that happens in time. forceSubmit() is a no-op if
   * the session already finished, so this stays safe to fire even after a
   * legitimate reconnect completed the interview through some other path.
   */
  handleDisconnect(client: Socket): void {
    const applicationId = (client.data as { applicationId?: string })
      .applicationId;
    if (!applicationId) return;
    const existing = this.pendingDisconnects.get(applicationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingDisconnects.delete(applicationId);
      this.sessions
        .forceSubmit(applicationId, 'AUTO_SUBMITTED_BROWSER_CLOSED')
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to force-submit application ${applicationId} on disconnect: ${errorMessage(error)}`,
          );
        });
    }, DISCONNECT_GRACE_MS);
    this.pendingDisconnects.set(applicationId, timer);
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
