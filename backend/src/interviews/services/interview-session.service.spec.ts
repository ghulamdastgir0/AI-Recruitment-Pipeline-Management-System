import { GoneException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AudioStorageService } from '../../shared/audio/audio-storage.service';
import { GroqAudioService } from '../../shared/audio/groq-audio.service';
import { InterviewOrchestratorService } from './interview-orchestrator.service';
import { InterviewSessionService } from './interview-session.service';

function buildService() {
  const prisma = {
    application: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    aIInterviewSession: { update: jest.fn().mockResolvedValue({}) },
    aIInterviewQuestion: {
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    skill: { upsert: jest.fn() },
    candidateSkillGrade: { upsert: jest.fn().mockResolvedValue({}) },
    interviewViolation: {
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as jest.Mocked<PrismaService>;

  const audio = {
    transcribe: jest.fn().mockResolvedValue('my answer'),
    synthesizeSpeech: jest.fn().mockResolvedValue(Buffer.from('audio')),
  } as unknown as jest.Mocked<GroqAudioService>;

  const storage = {
    save: jest.fn().mockResolvedValue({ filePath: '/storage/x.wav' }),
    read: jest.fn().mockResolvedValue(Buffer.from('audio')),
  } as unknown as jest.Mocked<AudioStorageService>;

  const orchestrator = {
    nextTurn: jest.fn(),
    grade: jest.fn(),
  } as unknown as jest.Mocked<InterviewOrchestratorService>;

  return {
    service: new InterviewSessionService(prisma, audio, storage, orchestrator),
    prisma,
    audio,
    storage,
    orchestrator,
  };
}

const inTheFuture = new Date(Date.now() + 60 * 60 * 1000);
const inThePast = new Date(Date.now() - 1000);

describe('InterviewSessionService', () => {
  describe('start', () => {
    it('throws NotFoundException when no interview has been scheduled', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        interviewSession: null,
      });

      await expect(service.start('app-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('expires and throws GoneException once the interview window has passed', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        interviewSession: {
          id: 'session-1',
          status: 'PENDING',
          windowExpiresAt: inThePast,
          questions: [],
        },
      });

      await expect(service.start('app-1')).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(prisma.aIInterviewSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: { status: 'EXPIRED' },
        }),
      );
      expect(prisma.application.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'app-1' },
          data: { status: 'INTERVIEW_EXPIRED' },
        }),
      );
    });

    it('generates and returns the first question for a PENDING session', async () => {
      const { service, prisma, orchestrator, audio, storage } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        candidateProfile: { extractedDataJson: { skills: ['TypeScript'] } },
        job: {
          title: 'Backend Engineer',
          jobSkills: [{ required: true, skill: { name: 'TypeScript' } }],
        },
        interviewSession: {
          id: 'session-1',
          status: 'PENDING',
          windowExpiresAt: inTheFuture,
          questions: [],
        },
      });
      orchestrator.nextTurn.mockResolvedValue({
        complete: false,
        questionText: 'What is TypeScript?',
        expectedCore: 'Typed superset of JS',
        targetSkillName: 'TypeScript',
        isFollowUp: false,
      });
      (prisma.skill.upsert as jest.Mock).mockResolvedValue({
        id: 'skill-1',
        name: 'TypeScript',
      });
      (prisma.aIInterviewQuestion.create as jest.Mock).mockResolvedValue({
        id: 'q-1',
        sequenceOrder: 1,
        questionText: 'What is TypeScript?',
      });

      const result = await service.start('app-1');

      expect(orchestrator.nextTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          canAskFresh: true,
          canFollowUp: false,
          transcript: [],
        }),
      );
      expect(audio.synthesizeSpeech).toHaveBeenCalledWith(
        'What is TypeScript?',
      );
      expect(storage.save).toHaveBeenCalled();
      expect(prisma.aIInterviewSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
      expect(result).toEqual({
        questionId: 'q-1',
        sequenceOrder: 1,
        questionText: 'What is TypeScript?',
        questionAudioUrl: '/interview-sessions/questions/q-1/audio',
      });
    });

    it('resumes an IN_PROGRESS session by returning the existing unanswered question, without generating a new one', async () => {
      const { service, prisma, orchestrator } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        interviewSession: {
          id: 'session-1',
          status: 'IN_PROGRESS',
          windowExpiresAt: inTheFuture,
          questions: [
            {
              id: 'q-1',
              sequenceOrder: 1,
              questionText: 'Q1',
              answeredAt: null,
            },
          ],
        },
      });

      const result = await service.start('app-1');

      expect(result.questionId).toBe('q-1');
      expect(orchestrator.nextTurn).not.toHaveBeenCalled();
    });
  });

  describe('answer', () => {
    it('transcribes the answer and returns the next question when caps are not yet hit', async () => {
      const { service, prisma, orchestrator, audio } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        candidateProfile: { extractedDataJson: { skills: [] } },
        job: { title: 'Backend Engineer', jobSkills: [] },
        interviewSession: {
          id: 'session-1',
          status: 'IN_PROGRESS',
          windowExpiresAt: inTheFuture,
          questions: [
            {
              id: 'q-1',
              sequenceOrder: 1,
              questionText: 'Q1',
              answerText: null,
              answeredAt: null,
              isFollowUp: false,
              expectedCore: 'core1',
              targetSkill: { name: 'Skill1' },
            },
          ],
        },
      });
      orchestrator.nextTurn.mockResolvedValue({
        complete: false,
        questionText: 'Q2',
        expectedCore: 'core2',
        targetSkillName: 'Skill2',
        isFollowUp: false,
      });
      (prisma.skill.upsert as jest.Mock).mockResolvedValue({
        id: 'skill-2',
        name: 'Skill2',
      });
      (prisma.aIInterviewQuestion.create as jest.Mock).mockResolvedValue({
        id: 'q-2',
        sequenceOrder: 2,
        questionText: 'Q2',
      });

      const result = await service.answer('app-1', {
        buffer: Buffer.from('audio bytes'),
        originalname: 'answer.wav',
      });

      expect(audio.transcribe).toHaveBeenCalledWith(
        Buffer.from('audio bytes'),
        'answer.wav',
      );
      expect(prisma.aIInterviewQuestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-1' },
          data: expect.objectContaining({ answerText: 'my answer' }),
        }),
      );
      expect(orchestrator.nextTurn).toHaveBeenCalledWith(
        expect.objectContaining({ canAskFresh: true, canFollowUp: true }),
      );
      expect(result).toEqual({
        questionId: 'q-2',
        sequenceOrder: 2,
        questionText: 'Q2',
        questionAudioUrl: '/interview-sessions/questions/q-2/audio',
      });
    });

    it('completes the interview once the distinct-skill and follow-up caps are both hit, without asking the LLM for another turn', async () => {
      const { service, prisma, orchestrator } = buildService();

      const answered = [1, 2, 3, 4].map((n) => ({
        id: `q${n}`,
        sequenceOrder: n,
        questionText: `Q${n}`,
        answerText: `A${n}`,
        answeredAt: new Date(),
        isFollowUp: false,
        expectedCore: `core${n}`,
        targetSkill: { name: `Skill${n}` },
      }));
      const followUps = [5, 6].map((n) => ({
        id: `q${n}`,
        sequenceOrder: n,
        questionText: `F${n}`,
        answerText: `A${n}`,
        answeredAt: new Date(),
        isFollowUp: true,
        expectedCore: `coreF${n}`,
        targetSkill: { name: 'Skill1' },
      }));
      const pending = {
        id: 'q7',
        sequenceOrder: 7,
        questionText: 'Q5',
        answerText: null,
        answeredAt: null,
        isFollowUp: false,
        expectedCore: 'core5',
        targetSkill: { name: 'Skill5' },
      };

      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        skillMatchPct: 80,
        candidateProfile: { extractedDataJson: { skills: [] } },
        job: { title: 'Backend Engineer', jobSkills: [] },
        interviewSession: {
          id: 'session-1',
          status: 'IN_PROGRESS',
          windowExpiresAt: inTheFuture,
          questions: [...answered, ...followUps, pending],
        },
      });
      (prisma.application.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: 'app-1',
        skillMatchPct: 80,
        job: { title: 'Backend Engineer' },
      });
      orchestrator.grade.mockResolvedValue({
        overallScore: 88,
        skills: [
          {
            skillName: 'Skill5',
            proficiencyScore: 90,
            justification: 'Great answer.',
          },
        ],
        recommendation: 'HIRE',
        summary: 'Strong overall performance.',
      });
      (prisma.skill.upsert as jest.Mock).mockResolvedValue({
        id: 'skill-5',
        name: 'Skill5',
      });

      const result = await service.answer('app-1', {
        buffer: Buffer.from('a'),
        originalname: 'answer.wav',
      });

      expect(orchestrator.nextTurn).not.toHaveBeenCalled();
      expect(orchestrator.grade).toHaveBeenCalled();
      // Candidate-facing result is deliberately score-free — the real
      // score/skills are still persisted (asserted below) but never
      // returned to the candidate directly.
      expect(result).toEqual({
        status: 'COMPLETED',
        message: expect.any(String),
      });
      expect(prisma.aIInterviewSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            overallScore: 88,
          }),
        }),
      );
      // compositeScore = 0.5*80 (match) + 0.5*88 (interview) = 84
      expect(prisma.application.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'app-1' },
          data: expect.objectContaining({
            status: 'IN_REVIEW',
            compositeScore: 84,
          }),
        }),
      );
    });
  });

  describe('answer — stale retry / questionId misattribution guard', () => {
    function mockInProgressSession() {
      return {
        id: 'app-1',
        candidateProfile: { extractedDataJson: { skills: [] } },
        job: { title: 'Backend Engineer', jobSkills: [] },
        interviewSession: {
          id: 'session-1',
          status: 'IN_PROGRESS',
          windowExpiresAt: inTheFuture,
          questions: [
            {
              id: 'q-1',
              sequenceOrder: 1,
              questionText: 'Q1',
              answerText: 'already answered',
              answeredAt: new Date(),
              isFollowUp: false,
              expectedCore: 'core1',
              targetSkill: { name: 'Skill1' },
            },
            {
              id: 'q-2',
              sequenceOrder: 2,
              questionText: 'Q2',
              answerText: null,
              answeredAt: null,
              isFollowUp: false,
              expectedCore: 'core2',
              targetSkill: { name: 'Skill2' },
            },
          ],
        },
      };
    }

    it('returns the current pending question instead of transcribing a stale retry against an already-answered question', async () => {
      const { service, prisma, audio } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(
        mockInProgressSession(),
      );

      const result = await service.answer(
        'app-1',
        { buffer: Buffer.from('stale audio'), originalname: 'answer.wav' },
        'q-1',
      );

      expect(result).toEqual({
        questionId: 'q-2',
        sequenceOrder: 2,
        questionText: 'Q2',
        questionAudioUrl: '/interview-sessions/questions/q-2/audio',
      });
      expect(audio.transcribe).not.toHaveBeenCalled();
      expect(prisma.aIInterviewQuestion.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when questionId matches no question in the session', async () => {
      const { service, prisma, audio } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(
        mockInProgressSession(),
      );

      await expect(
        service.answer(
          'app-1',
          { buffer: Buffer.from('audio'), originalname: 'answer.wav' },
          'q-unknown',
        ),
      ).rejects.toThrow(
        'This question is no longer awaiting an answer — refresh and try again.',
      );
      expect(audio.transcribe).not.toHaveBeenCalled();
    });

    it('proceeds normally when questionId matches the current pending question', async () => {
      const { service, prisma, orchestrator, audio } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(
        mockInProgressSession(),
      );
      orchestrator.nextTurn.mockResolvedValue({
        complete: false,
        questionText: 'Q3',
        expectedCore: 'core3',
        targetSkillName: 'Skill3',
        isFollowUp: false,
      });
      (prisma.skill.upsert as jest.Mock).mockResolvedValue({
        id: 'skill-3',
        name: 'Skill3',
      });
      (prisma.aIInterviewQuestion.create as jest.Mock).mockResolvedValue({
        id: 'q-3',
        sequenceOrder: 3,
        questionText: 'Q3',
      });

      await service.answer(
        'app-1',
        { buffer: Buffer.from('audio'), originalname: 'answer.wav' },
        'q-2',
      );

      expect(audio.transcribe).toHaveBeenCalled();
      expect(prisma.aIInterviewQuestion.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q-2' } }),
      );
    });

    it('returns a COMPLETED result for a stale retry that arrives after the interview already finished', async () => {
      const { service, prisma, audio } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        candidateProfile: { extractedDataJson: { skills: [] } },
        job: { title: 'Backend Engineer', jobSkills: [] },
        interviewSession: {
          id: 'session-1',
          status: 'COMPLETED',
          windowExpiresAt: inTheFuture,
          questions: [],
        },
      });

      const result = await service.answer(
        'app-1',
        { buffer: Buffer.from('stale audio'), originalname: 'answer.wav' },
        'q-1',
      );

      expect(result).toEqual({
        status: 'COMPLETED',
        message: expect.any(String),
      });
      expect(audio.transcribe).not.toHaveBeenCalled();
    });
  });

  describe('getQuestionAudio', () => {
    it('throws NotFoundException when the question or its audio does not exist', async () => {
      const { service, prisma } = buildService();
      (prisma.aIInterviewQuestion.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.getQuestionAudio('q-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reads and returns the stored audio buffer', async () => {
      const { service, prisma, storage } = buildService();
      (prisma.aIInterviewQuestion.findUnique as jest.Mock).mockResolvedValue({
        id: 'q-1',
        questionAudioUrl: '/storage/x.wav',
      });

      const buffer = await service.getQuestionAudio('q-1');

      expect(storage.read).toHaveBeenCalledWith('/storage/x.wav');
      expect(buffer).toEqual(Buffer.from('audio'));
    });
  });

  describe('getStatus', () => {
    it('reports a terminal failure message (not "still being reviewed") when CV processing failed', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'APPLIED',
        candidateProfile: { cvStatus: 'FAILED' },
        interviewSession: null,
      });

      const status = await service.getStatus('app-1');

      expect(status.terminal).toBe(true);
      expect(status.message).not.toMatch(/still being reviewed/i);
    });

    it('reports "still being reviewed" while the CV has not failed and no session exists yet', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'APPLIED',
        candidateProfile: { cvStatus: 'PROCESSING' },
        interviewSession: null,
      });

      const status = await service.getStatus('app-1');

      expect(status.terminal).toBeUndefined();
      expect(status.message).toMatch(/still being reviewed/i);
    });

    function withCompletedSession(applicationStatus: string) {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: applicationStatus,
        candidateProfile: { cvStatus: 'READY' },
        interviewSession: {
          id: 'session-1',
          status: 'COMPLETED',
          windowExpiresAt: inTheFuture,
          questions: [],
        },
      });
      return service.getStatus('app-1');
    }

    it('reports the interview-under-review message while the application is still IN_REVIEW', async () => {
      const status = await withCompletedSession('IN_REVIEW');
      expect(status.message).toBe(
        'Your interview has been completed and is under review.',
      );
      expect(status.candidateStatus).toBe('INTERVIEW_COMPLETED');
    });

    it('does not freeze on the interview-completed message once the application moves to MANAGER_REVIEW', async () => {
      const status = await withCompletedSession('MANAGER_REVIEW');
      expect(status.message).not.toMatch(/under review$/);
      expect(status.message).toMatch(/final review/i);
      expect(status.candidateStatus).toBe('FINAL_REVIEW');
    });

    it('keeps the same final-review message once the Hiring Manager marks their review done (MANAGER_REVIEWED)', async () => {
      const status = await withCompletedSession('MANAGER_REVIEWED');
      expect(status.message).toMatch(/final review/i);
      expect(status.candidateStatus).toBe('FINAL_REVIEW');
    });

    it('reports a selection message once the application is SELECTED', async () => {
      const status = await withCompletedSession('SELECTED');
      expect(status.message).toMatch(/selected/i);
      expect(status.candidateStatus).toBe('ACCEPTED');
    });

    it('reports a rejection message once the application is REJECTED', async () => {
      const status = await withCompletedSession('REJECTED');
      expect(status.message).toMatch(/not to move forward/i);
      expect(status.candidateStatus).toBe('REJECTED');
    });
  });
});
