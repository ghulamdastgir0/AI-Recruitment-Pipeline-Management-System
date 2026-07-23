import { NotFoundException } from '@nestjs/common';
import { Socket } from 'socket.io';
import { InterviewGateway } from './interview.gateway';
import { InterviewSessionService } from './services/interview-session.service';

function buildGateway() {
  const sessions = {
    start: jest.fn(),
    answer: jest.fn(),
  } as unknown as jest.Mocked<InterviewSessionService>;
  const client = { emit: jest.fn() } as unknown as jest.Mocked<Socket>;

  return { gateway: new InterviewGateway(sessions), sessions, client };
}

describe('InterviewGateway', () => {
  describe('join', () => {
    it('emits a question event on success', async () => {
      const { gateway, sessions, client } = buildGateway();
      const turn = {
        questionId: 'q-1',
        sequenceOrder: 1,
        questionText: 'Q1',
        questionAudioUrl: '/interview-sessions/questions/q-1/audio',
      };
      sessions.start.mockResolvedValue(turn);

      await gateway.handleJoin({ applicationId: 'app-1' }, client);

      expect(sessions.start).toHaveBeenCalledWith('app-1');
      expect(client.emit).toHaveBeenCalledWith('question', turn);
    });

    it('emits an error event instead of throwing when the service rejects', async () => {
      const { gateway, sessions, client } = buildGateway();
      sessions.start.mockRejectedValue(
        new NotFoundException('No interview scheduled.'),
      );

      await gateway.handleJoin({ applicationId: 'app-1' }, client);

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'No interview scheduled.',
      });
    });
  });

  describe('answer', () => {
    it('converts the ArrayBuffer to a Buffer and emits the next question when not complete', async () => {
      const { gateway, sessions, client } = buildGateway();
      const nextQuestion = {
        questionId: 'q-2',
        sequenceOrder: 2,
        questionText: 'Q2',
        questionAudioUrl: '/interview-sessions/questions/q-2/audio',
      };
      sessions.answer.mockResolvedValue(nextQuestion);
      const audio = new Uint8Array([1, 2, 3]).buffer;

      await gateway.handleAnswer(
        { applicationId: 'app-1', audio, filename: 'answer.webm' },
        client,
      );

      expect(sessions.answer).toHaveBeenCalledWith('app-1', {
        buffer: Buffer.from(audio),
        originalname: 'answer.webm',
      });
      expect(client.emit).toHaveBeenCalledWith('question', nextQuestion);
    });

    it('emits a completed event when the interview finishes', async () => {
      const { gateway, sessions, client } = buildGateway();
      const result = {
        status: 'COMPLETED' as const,
        message: 'Your interview was submitted successfully.',
      };
      sessions.answer.mockResolvedValue(result);

      await gateway.handleAnswer(
        {
          applicationId: 'app-1',
          audio: new ArrayBuffer(0),
          filename: 'answer.webm',
        },
        client,
      );

      expect(client.emit).toHaveBeenCalledWith('completed', result);
    });

    it('emits an error event instead of throwing when the service rejects', async () => {
      const { gateway, sessions, client } = buildGateway();
      sessions.answer.mockRejectedValue(new Error('groq down'));

      await gateway.handleAnswer(
        {
          applicationId: 'app-1',
          audio: new ArrayBuffer(0),
          filename: 'answer.webm',
        },
        client,
      );

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'groq down',
      });
    });
  });
});
