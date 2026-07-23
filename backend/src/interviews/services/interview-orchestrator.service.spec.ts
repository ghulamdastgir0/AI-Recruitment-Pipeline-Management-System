import { LlmClientService } from '../../shared/llm/llm-client.service';
import { InterviewOrchestratorService } from './interview-orchestrator.service';

function buildService() {
  const llm = { chat: jest.fn() } as unknown as jest.Mocked<LlmClientService>;
  return { service: new InterviewOrchestratorService(llm), llm };
}

function chatResult(content: unknown) {
  return {
    message: { role: 'assistant' as const, content: JSON.stringify(content) },
    finishReason: 'stop',
  };
}

describe('InterviewOrchestratorService', () => {
  describe('nextTurn', () => {
    it('short-circuits to complete without calling the LLM when neither fresh nor follow-up is allowed', async () => {
      const { service, llm } = buildService();

      const result = await service.nextTurn({
        jobTitle: 'Backend Engineer',
        requiredSkills: [],
        preferredSkills: [],
        candidateSkills: [],
        transcript: [],
        canAskFresh: false,
        canFollowUp: false,
      });

      expect(result).toEqual({ complete: true });
      expect(llm.chat).not.toHaveBeenCalled();
    });

    it('returns a fresh question from a valid LLM response', async () => {
      const { service, llm } = buildService();
      llm.chat.mockResolvedValue(
        chatResult({
          complete: false,
          questionText: 'What is a closure?',
          expectedCore: 'Lexical scoping, retained variables',
          targetSkillName: 'JavaScript',
          isFollowUp: false,
        }),
      );

      const result = await service.nextTurn({
        jobTitle: 'Backend Engineer',
        requiredSkills: ['JavaScript'],
        preferredSkills: [],
        candidateSkills: ['JavaScript'],
        transcript: [],
        canAskFresh: true,
        canFollowUp: false,
      });

      expect(result).toEqual({
        complete: false,
        questionText: 'What is a closure?',
        expectedCore: 'Lexical scoping, retained variables',
        targetSkillName: 'JavaScript',
        isFollowUp: false,
      });
    });

    it('forces isFollowUp to false when the caller disallows follow-ups, even if the model set it true', async () => {
      const { service, llm } = buildService();
      llm.chat.mockResolvedValue(
        chatResult({
          complete: false,
          questionText: 'Explain event loop.',
          expectedCore: 'Call stack, task queue',
          targetSkillName: 'JavaScript',
          isFollowUp: true,
        }),
      );

      const result = await service.nextTurn({
        jobTitle: 'Backend Engineer',
        requiredSkills: [],
        preferredSkills: [],
        candidateSkills: [],
        transcript: [],
        canAskFresh: true,
        canFollowUp: false,
      });

      expect(result).toMatchObject({ isFollowUp: false });
    });

    it('retries on a malformed response and succeeds on the next attempt', async () => {
      const { service, llm } = buildService();
      llm.chat
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: 'not json' },
          finishReason: 'stop',
        })
        .mockResolvedValueOnce(
          chatResult({
            complete: false,
            questionText: 'What is a race condition?',
            expectedCore: 'Concurrent access, non-deterministic ordering',
            targetSkillName: 'Concurrency',
            isFollowUp: false,
          }),
        );

      const result = await service.nextTurn({
        jobTitle: 'Backend Engineer',
        requiredSkills: [],
        preferredSkills: [],
        candidateSkills: [],
        transcript: [],
        canAskFresh: true,
        canFollowUp: false,
      });

      expect(llm.chat).toHaveBeenCalledTimes(2);
      expect(result.complete).toBe(false);
    });

    it('degrades gracefully to complete:true (never throws) after exhausting retries', async () => {
      const { service, llm } = buildService();
      llm.chat.mockRejectedValue(new Error('groq down'));

      const result = await service.nextTurn({
        jobTitle: 'Backend Engineer',
        requiredSkills: [],
        preferredSkills: [],
        candidateSkills: [],
        transcript: [],
        canAskFresh: true,
        canFollowUp: false,
      });

      expect(result).toEqual({ complete: true });
    });

    it('loops back through the graph across two failures before succeeding on the third attempt', async () => {
      const { service, llm } = buildService();
      llm.chat
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: 'not json' },
          finishReason: 'stop',
        })
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: '{}' },
          finishReason: 'stop',
        })
        .mockResolvedValueOnce(
          chatResult({
            complete: false,
            questionText: 'Explain optimistic locking.',
            expectedCore: 'Version check on write, retry on conflict',
            targetSkillName: 'Databases',
            isFollowUp: false,
          }),
        );

      const result = await service.nextTurn({
        jobTitle: 'Backend Engineer',
        requiredSkills: [],
        preferredSkills: [],
        candidateSkills: [],
        transcript: [],
        canAskFresh: true,
        canFollowUp: false,
      });

      expect(llm.chat).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({
        complete: false,
        targetSkillName: 'Databases',
      });
    });
  });

  describe('grade', () => {
    it('returns the overall score and per-skill grades from a valid response', async () => {
      const { service, llm } = buildService();
      llm.chat.mockResolvedValue(
        chatResult({
          overallScore: 82,
          skills: [
            {
              skillName: 'JavaScript',
              proficiencyScore: 85,
              justification: 'Explained closures correctly.',
            },
          ],
        }),
      );

      const result = await service.grade({
        jobTitle: 'Backend Engineer',
        skillGroups: [
          {
            skillName: 'JavaScript',
            entries: [
              {
                questionText: 'What is a closure?',
                answerText: 'A function with retained scope.',
                expectedCore: 'Lexical scoping',
              },
            ],
          },
        ],
      });

      expect(result.overallScore).toBe(82);
      expect(result.skills).toEqual([
        {
          skillName: 'JavaScript',
          proficiencyScore: 85,
          justification: 'Explained closures correctly.',
        },
      ]);
    });

    it('clamps out-of-range scores into 0-100', async () => {
      const { service, llm } = buildService();
      llm.chat.mockResolvedValue(
        chatResult({
          overallScore: 140,
          skills: [
            {
              skillName: 'JavaScript',
              proficiencyScore: -5,
              justification: 'x',
            },
          ],
        }),
      );

      const result = await service.grade({
        jobTitle: 'Backend Engineer',
        skillGroups: [{ skillName: 'JavaScript', entries: [] }],
      });

      expect(result.overallScore).toBe(100);
      expect(result.skills[0].proficiencyScore).toBe(0);
    });

    it('retries once on an invalid shape and succeeds on the next attempt', async () => {
      const { service, llm } = buildService();
      llm.chat
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: '{}' },
          finishReason: 'stop',
        })
        .mockResolvedValueOnce(
          chatResult({
            overallScore: 70,
            skills: [
              {
                skillName: 'JavaScript',
                proficiencyScore: 70,
                justification: 'Solid understanding overall.',
              },
            ],
          }),
        );

      const result = await service.grade({
        jobTitle: 'Backend Engineer',
        skillGroups: [{ skillName: 'JavaScript', entries: [] }],
      });

      expect(llm.chat).toHaveBeenCalledTimes(2);
      expect(result.overallScore).toBe(70);
    });

    it('throws after exhausting retries on persistently invalid output', async () => {
      const { service, llm } = buildService();
      llm.chat.mockResolvedValue({
        message: { role: 'assistant', content: '{}' },
        finishReason: 'stop',
      });

      await expect(
        service.grade({
          jobTitle: 'Backend Engineer',
          skillGroups: [{ skillName: 'JavaScript', entries: [] }],
        }),
      ).rejects.toThrow(
        /Interview grading produced invalid structured data after 3 attempts/,
      );
    });
  });
});
