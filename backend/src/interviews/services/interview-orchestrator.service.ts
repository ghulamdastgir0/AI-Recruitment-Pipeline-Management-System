import { Injectable } from '@nestjs/common';
import { LlmClientService } from '../../shared/llm/llm-client.service';

export interface TranscriptEntry {
  questionText: string;
  answerText: string | null;
  targetSkillName: string | null;
  isFollowUp: boolean;
}

export interface NextTurnInput {
  jobTitle: string;
  requiredSkills: string[];
  preferredSkills: string[];
  candidateSkills: string[];
  transcript: TranscriptEntry[];
  canAskFresh: boolean;
  canFollowUp: boolean;
}

export type NextTurnResult =
  | { complete: true }
  | {
      complete: false;
      questionText: string;
      expectedCore: string;
      targetSkillName: string;
      isFollowUp: boolean;
    };

export interface SkillEvidenceGroup {
  skillName: string;
  entries: {
    questionText: string;
    answerText: string | null;
    expectedCore: string;
  }[];
}

export interface GradeInput {
  jobTitle: string;
  skillGroups: SkillEvidenceGroup[];
}

export interface GradeResult {
  overallScore: number;
  skills: {
    skillName: string;
    proficiencyScore: number;
    justification: string;
  }[];
}

const MAX_ATTEMPTS = 3;

/**
 * The LLM reasoning layer for the AI interview: decides what to ask next
 * (fresh skill vs. targeted follow-up, or wrap up) and, once done, grades
 * the transcript per skill with a justification for each score. Hard turn
 * caps live in InterviewSessionService (the caller) — this only respects
 * whatever canAskFresh/canFollowUp flags it's given, it doesn't enforce them.
 */
@Injectable()
export class InterviewOrchestratorService {
  constructor(private readonly llm: LlmClientService) {}

  async nextTurn(input: NextTurnInput): Promise<NextTurnResult> {
    if (!input.canAskFresh && !input.canFollowUp) {
      return { complete: true };
    }

    const options =
      input.canAskFresh && input.canFollowUp
        ? "You may either (a) ask a NEW question on a skill not yet covered, or (b) if the candidate's last answer was vague, superficial, or shallow, ask ONE targeted follow-up on the same skill to probe deeper."
        : input.canFollowUp
          ? 'The only option available is a targeted follow-up on the most recently answered question, and only if genuinely warranted — otherwise mark the interview complete.'
          : 'Ask a NEW question on a skill not yet covered.';

    const systemPrompt = `You are conducting a short, friendly technical interview for a "${input.jobTitle}" role. Ask one focused technical question at a time to assess real proficiency, not memorized trivia.

Required skills to prioritize: ${input.requiredSkills.join(', ') || 'none specified'}.
Preferred skills: ${input.preferredSkills.join(', ') || 'none specified'}.
The candidate's CV lists these skills: ${input.candidateSkills.join(', ') || 'none listed'}.

${options}

Return ONLY a JSON object: { "complete": boolean, "questionText": string | null, "expectedCore": string | null, "targetSkillName": string | null, "isFollowUp": boolean }
- If complete is true, set questionText/expectedCore/targetSkillName to null and isFollowUp to false.
- expectedCore is the key point(s) a strong answer should cover — this is grading criteria, never shown to the candidate.
- targetSkillName must be one short skill name (e.g. "React", "SQL joins"), not a sentence.`;

    const transcriptText = input.transcript.length
      ? input.transcript
          .map(
            (t, i) =>
              `Q${i + 1} (${t.targetSkillName ?? 'unknown'}${t.isFollowUp ? ', follow-up' : ''}): ${t.questionText}\nA${i + 1}: ${t.answerText ?? '(no answer)'}`,
          )
          .join('\n\n')
      : '(interview not started yet — this is the first question)';

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                attempt === 1
                  ? `Transcript so far:\n\n${transcriptText}`
                  : `Transcript so far:\n\n${transcriptText}\n\nYour previous output was invalid (${lastError}). Return ONLY the JSON object described — no prose, no markdown.`,
            },
          ],
          { jsonResponse: true },
        );

        const parsed = JSON.parse(result.message.content ?? '{}') as {
          complete?: boolean;
          questionText?: string | null;
          expectedCore?: string | null;
          targetSkillName?: string | null;
          isFollowUp?: boolean;
        };

        if (parsed.complete) {
          return { complete: true };
        }
        if (
          typeof parsed.questionText === 'string' &&
          parsed.questionText.trim() &&
          typeof parsed.expectedCore === 'string' &&
          parsed.expectedCore.trim() &&
          typeof parsed.targetSkillName === 'string' &&
          parsed.targetSkillName.trim()
        ) {
          return {
            complete: false,
            questionText: parsed.questionText.trim(),
            expectedCore: parsed.expectedCore.trim(),
            targetSkillName: parsed.targetSkillName.trim(),
            isFollowUp: Boolean(parsed.isFollowUp) && input.canFollowUp,
          };
        }
        lastError = 'missing required fields for a non-complete turn';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // Exhausted retries — end the interview gracefully rather than fail the
    // candidate's request outright; grading works fine on a shorter transcript.
    return { complete: true };
  }

  async grade(input: GradeInput): Promise<GradeResult> {
    const systemPrompt = `You are grading a completed technical interview transcript for a "${input.jobTitle}" role.

For each skill below, assign a proficiencyScore from 0 to 100 and a one-to-two sentence justification citing specifically what the candidate did or didn't demonstrate, comparing their answer(s) against the listed expected core points (your grading rubric — never shown to the candidate). Also produce an overallScore (0-100) summarizing overall technical performance across all skills.

Return ONLY JSON: { "overallScore": number, "skills": [{ "skillName": string, "proficiencyScore": number, "justification": string }] }
The skills array must contain exactly one entry per skill listed below, in the same order.`;

    const transcriptText = input.skillGroups
      .map(
        (group, i) =>
          `Skill ${i + 1}: ${group.skillName}\n` +
          group.entries
            .map(
              (e, j) =>
                `  Q${j + 1}: ${e.questionText}\n  Expected core: ${e.expectedCore}\n  Answer: ${e.answerText ?? '(no answer)'}`,
            )
            .join('\n'),
      )
      .join('\n\n');

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                attempt === 1
                  ? transcriptText
                  : `${transcriptText}\n\nYour previous output was invalid (${lastError}). Return ONLY the JSON object described — no prose, no markdown.`,
            },
          ],
          { jsonResponse: true },
        );

        const parsed = JSON.parse(result.message.content ?? '{}') as {
          overallScore?: number;
          skills?: {
            skillName?: string;
            proficiencyScore?: number;
            justification?: string;
          }[];
        };

        if (
          typeof parsed.overallScore === 'number' &&
          Array.isArray(parsed.skills) &&
          parsed.skills.length > 0 &&
          parsed.skills.every(
            (s) =>
              typeof s.skillName === 'string' &&
              typeof s.proficiencyScore === 'number' &&
              typeof s.justification === 'string' &&
              s.justification.trim(),
          )
        ) {
          return {
            overallScore: clampScore(parsed.overallScore),
            skills: parsed.skills.map((s) => ({
              skillName: s.skillName!.trim(),
              proficiencyScore: clampScore(s.proficiencyScore!),
              justification: s.justification!.trim(),
            })),
          };
        }
        lastError = 'missing/invalid overallScore or skills[] shape';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(
      `Interview grading produced invalid structured data after ${MAX_ATTEMPTS} attempts: ${lastError}`,
    );
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
