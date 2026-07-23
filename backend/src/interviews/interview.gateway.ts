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
})
export class InterviewGateway {
  constructor(private readonly sessions: InterviewSessionService) {}

  @SubscribeMessage('join')
  async handleJoin(
    @MessageBody() body: JoinPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
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
    try {
      const result = await this.sessions.answer(body.applicationId, {
        buffer: Buffer.from(body.audio),
        originalname: body.filename,
      });
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
