import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
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

export const INTERVIEW_RECOMMENDATIONS = [
  'STRONG_HIRE',
  'HIRE',
  'NO_HIRE',
  'STRONG_NO_HIRE',
] as const;
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

export interface GradeResult {
  overallScore: number;
  skills: {
    skillName: string;
    proficiencyScore: number;
    justification: string;
  }[];
  /** Interview-level hire/no-hire-leaning call — distinct from MatchResult.recommendation (CV-match only). */
  recommendation: InterviewRecommendation;
  /** Plain-language narrative summarizing the whole session, not just per-skill scores. */
  summary: string;
}

const MAX_ATTEMPTS = 3;

function buildNextTurnSystemPrompt(input: NextTurnInput): string {
  const options =
    input.canAskFresh && input.canFollowUp
      ? "You may either (a) ask a NEW question on a skill not yet covered, or (b) if the candidate's last answer was vague, superficial, or shallow, ask ONE targeted follow-up on the same skill to probe deeper."
      : input.canFollowUp
        ? 'The only option available is a targeted follow-up on the most recently answered question, and only if genuinely warranted — otherwise mark the interview complete.'
        : 'Ask a NEW question on a skill not yet covered.';

  return `You are conducting a short, friendly technical interview for a "${input.jobTitle}" role. Ask one focused technical question at a time to assess real proficiency, not memorized trivia.

This is a VERBAL, spoken-only interview — the candidate answers out loud and has no keyboard, editor, or whiteboard. NEVER ask them to write, type, or code up a solution. If you want to assess coding/algorithmic knowledge, instead:
- Include a short code snippet directly in questionText and ask the candidate to dry-run it mentally and state what it outputs/does, or spot the bug in it.
- Ask them to explain, in their own words, how they'd approach or design something (no code required).
- Ask about time/space complexity of an approach, or to compare tradeoffs between two approaches.
- Ask them to walk through a concept, algorithm, or a piece of code you describe or paste into questionText.

Required skills to prioritize: ${input.requiredSkills.join(', ') || 'none specified'}.
Preferred skills: ${input.preferredSkills.join(', ') || 'none specified'}.
The candidate's CV lists these skills: ${input.candidateSkills.join(', ') || 'none listed'}.

${options}

Return ONLY a JSON object: { "complete": boolean, "questionText": string | null, "expectedCore": string | null, "targetSkillName": string | null, "isFollowUp": boolean }
- If complete is true, set questionText/expectedCore/targetSkillName to null and isFollowUp to false.
- expectedCore is the key point(s) a strong answer should cover — this is grading criteria, never shown to the candidate.
- targetSkillName must be one short skill name (e.g. "React", "SQL joins"), not a sentence.`;
}

function buildNextTurnTranscriptText(transcript: TranscriptEntry[]): string {
  return transcript.length
    ? transcript
        .map(
          (t, i) =>
            `Q${i + 1} (${t.targetSkillName ?? 'unknown'}${t.isFollowUp ? ', follow-up' : ''}): ${t.questionText}\nA${i + 1}: ${t.answerText ?? '(no answer)'}`,
        )
        .join('\n\n')
    : '(interview not started yet — this is the first question)';
}

function buildGradeSystemPrompt(input: GradeInput): string {
  return `You are grading a completed technical interview transcript for a "${input.jobTitle}" role.

For each skill below, assign a proficiencyScore from 0 to 100 and a one-to-two sentence justification citing specifically what the candidate did or didn't demonstrate, comparing their answer(s) against the listed expected core points (your grading rubric — never shown to the candidate). Also produce an overallScore (0-100) summarizing overall technical performance across all skills, a recommendation, and a short narrative summary of the whole session (2-4 sentences) — this is decision support for HR, never shown to the candidate.

Return ONLY JSON: { "overallScore": number, "skills": [{ "skillName": string, "proficiencyScore": number, "justification": string }], "recommendation": "STRONG_HIRE"|"HIRE"|"NO_HIRE"|"STRONG_NO_HIRE", "summary": string }
The skills array must contain exactly one entry per skill listed below, in the same order.`;
}

function buildGradeTranscriptText(skillGroups: SkillEvidenceGroup[]): string {
  return skillGroups
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
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const NextTurnState = Annotation.Root({
  input: Annotation<NextTurnInput>,
  attempt: Annotation<number>,
  lastError: Annotation<string>,
  result: Annotation<NextTurnResult | undefined>,
});

const GradeState = Annotation.Root({
  input: Annotation<GradeInput>,
  attempt: Annotation<number>,
  lastError: Annotation<string>,
  result: Annotation<GradeResult | undefined>,
});

/**
 * The LLM reasoning layer for the AI interview: decides what to ask next
 * (fresh skill vs. targeted follow-up, or wrap up) and, once done, grades
 * the transcript per skill with a justification for each score. Hard turn
 * caps live in InterviewSessionService (the caller) — this only respects
 * whatever canAskFresh/canFollowUp flags it's given, it doesn't enforce them.
 *
 * Both operations are LangGraph StateGraphs: a single "generate" node loops
 * back on itself (via a conditional edge) up to MAX_ATTEMPTS times whenever
 * the model's output is malformed, feeding the parse error back into the
 * next attempt's prompt — the same retry-with-feedback behavior the old
 * hand-rolled `for` loop had, just as an explicit, inspectable graph.
 * Each graph is compiled once (constructor) and invoked fresh per call —
 * conversation history is reconstructed from Postgres by the caller on every
 * turn, so there's no LangGraph checkpointer/persistence here to avoid a
 * second source of truth for interview state.
 */
@Injectable()
export class InterviewOrchestratorService {
  private readonly nextTurnGraph = this.buildNextTurnGraph();
  private readonly gradeGraph = this.buildGradeGraph();

  constructor(private readonly llm: LlmClientService) {}

  async nextTurn(input: NextTurnInput): Promise<NextTurnResult> {
    if (!input.canAskFresh && !input.canFollowUp) {
      return { complete: true };
    }

    const final = await this.nextTurnGraph.invoke({
      input,
      attempt: 1,
      lastError: '',
    });
    return final.result!;
  }

  async grade(input: GradeInput): Promise<GradeResult> {
    const final = await this.gradeGraph.invoke({
      input,
      attempt: 1,
      lastError: '',
    });
    return final.result!;
  }

  private buildNextTurnGraph() {
    const generateQuestion = async (
      state: typeof NextTurnState.State,
    ): Promise<typeof NextTurnState.Update> => {
      const { input, attempt, lastError } = state;
      const systemPrompt = buildNextTurnSystemPrompt(input);
      const transcriptText = buildNextTurnTranscriptText(input.transcript);
      const userContent =
        attempt === 1
          ? `Transcript so far:\n\n${transcriptText}`
          : `Transcript so far:\n\n${transcriptText}\n\nYour previous output was invalid (${lastError}). Return ONLY the JSON object described — no prose, no markdown.`;

      try {
        const result = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
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
          return { result: { complete: true } };
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
            result: {
              complete: false,
              questionText: parsed.questionText.trim(),
              expectedCore: parsed.expectedCore.trim(),
              targetSkillName: parsed.targetSkillName.trim(),
              isFollowUp: Boolean(parsed.isFollowUp) && input.canFollowUp,
            },
          };
        }
        return {
          attempt: attempt + 1,
          lastError: 'missing required fields for a non-complete turn',
        };
      } catch (error) {
        return {
          attempt: attempt + 1,
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
    };

    // Exhausted retries — end the interview gracefully rather than fail the
    // candidate's request outright; grading works fine on a shorter transcript.
    const fallback = (): typeof NextTurnState.Update => ({
      result: { complete: true },
    });

    return new StateGraph(NextTurnState)
      .addNode('generateQuestion', generateQuestion)
      .addNode('fallback', fallback)
      .addEdge(START, 'generateQuestion')
      .addConditionalEdges(
        'generateQuestion',
        (state) => {
          if (state.result) return 'done';
          if (state.attempt > MAX_ATTEMPTS) return 'fallback';
          return 'retry';
        },
        { done: END, retry: 'generateQuestion', fallback: 'fallback' },
      )
      .addEdge('fallback', END)
      .compile();
  }

  private buildGradeGraph() {
    const gradeSkills = async (
      state: typeof GradeState.State,
    ): Promise<typeof GradeState.Update> => {
      const { input, attempt, lastError } = state;
      const systemPrompt = buildGradeSystemPrompt(input);
      const transcriptText = buildGradeTranscriptText(input.skillGroups);
      const userContent =
        attempt === 1
          ? transcriptText
          : `${transcriptText}\n\nYour previous output was invalid (${lastError}). Return ONLY the JSON object described — no prose, no markdown.`;

      try {
        const result = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
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
          recommendation?: string;
          summary?: string;
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
          ) &&
          typeof parsed.summary === 'string' &&
          parsed.summary.trim() &&
          INTERVIEW_RECOMMENDATIONS.includes(
            parsed.recommendation as InterviewRecommendation,
          )
        ) {
          return {
            result: {
              overallScore: clampScore(parsed.overallScore),
              skills: parsed.skills.map((s) => ({
                skillName: s.skillName!.trim(),
                proficiencyScore: clampScore(s.proficiencyScore!),
                justification: s.justification!.trim(),
              })),
              recommendation: parsed.recommendation as InterviewRecommendation,
              summary: parsed.summary.trim(),
            },
          };
        }
        return {
          attempt: attempt + 1,
          lastError:
            'missing/invalid overallScore, skills[], recommendation, or summary shape',
        };
      } catch (error) {
        return {
          attempt: attempt + 1,
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
    };

    const fail = (state: typeof GradeState.State): never => {
      throw new Error(
        `Interview grading produced invalid structured data after ${MAX_ATTEMPTS} attempts: ${state.lastError}`,
      );
    };

    return new StateGraph(GradeState)
      .addNode('gradeSkills', gradeSkills)
      .addNode('fail', fail)
      .addEdge(START, 'gradeSkills')
      .addConditionalEdges(
        'gradeSkills',
        (state) => {
          if (state.result) return 'done';
          if (state.attempt > MAX_ATTEMPTS) return 'fail';
          return 'retry';
        },
        { done: END, retry: 'gradeSkills', fail: 'fail' },
      )
      .addEdge('fail', END)
      .compile();
  }
}
