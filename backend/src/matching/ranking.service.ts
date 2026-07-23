import { Injectable, NotFoundException } from '@nestjs/common';
import { resolveCandidateIdentity } from '../candidates/candidate-identity.util';
import { PrismaService } from '../prisma/prisma.service';
import { LlmClientService } from '../shared/llm/llm-client.service';

export interface RankedCandidate {
  applicationId: string;
  candidateProfileId: string;
  candidateName: string | null;
  /** Current Application status — lets HR see candidates that applied but haven't been scored yet. */
  applicationStatus: string;
  overallScore: number | null;
  recommendation: string | null;
  confidence: string | null;
  summary: string;
  missingRequiredSkills: string[];
  processedAt: Date | null;
}

export interface RankFilters {
  minScore?: number;
  recommendation?: string;
  limit?: number;
  /** Optional single LLM pass to reorder (never rescore) close ties among the top results. Off by default — the base order is already deterministic. */
  rerank?: boolean;
}

const RERANK_SYSTEM_PROMPT = `You reorder an already-scored, already-ranked candidate list for a job posting.
You may only change the ORDER of close/ambiguous cases based on the summaries given — never invent a new score,
never add or remove a candidate. Return a JSON object: {"order": [<1-based candidate numbers in your recommended order>]}.
The array must contain every input number exactly once.`;

@Injectable()
export class RankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClientService,
  ) {}

  async rank(
    jobPostingId: string,
    filters: RankFilters = {},
  ): Promise<RankedCandidate[]> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobPostingId },
    });
    if (!job) {
      throw new NotFoundException(
        `No job posting found with id "${jobPostingId}".`,
      );
    }

    const applications = await this.prisma.application.findMany({
      where: { jobId: jobPostingId },
      include: {
        candidateProfile: true,
        matchResults: { orderBy: { processedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Every application shows up here, scored or not — a candidate whose CV
    // is still processing (or whose scoring failed) is still "applied" from
    // HR's perspective and shouldn't silently vanish from the list.
    let ranked: RankedCandidate[] = applications
      .map((app) => {
        const { name: candidateName } = resolveCandidateIdentity(
          app.candidateProfile,
        );
        const latest = app.matchResults[0];
        if (latest) {
          return {
            applicationId: app.id,
            candidateProfileId: app.candidateProfileId,
            candidateName,
            applicationStatus: app.status,
            overallScore: Number(latest.overallScore),
            recommendation: latest.recommendation,
            confidence: latest.confidence,
            summary: latest.summary,
            missingRequiredSkills:
              (latest.missingRequiredSkillsJson as string[] | null) ?? [],
            processedAt: latest.processedAt,
          };
        }
        return {
          applicationId: app.id,
          candidateProfileId: app.candidateProfileId,
          candidateName,
          applicationStatus: app.status,
          overallScore: null,
          recommendation: null,
          confidence: null,
          summary: this.pendingSummary(
            app.candidateProfile.cvStatus,
            app.candidateProfile.cvProcessingError,
          ),
          missingRequiredSkills: [],
          processedAt: null,
        };
      })
      .sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));

    if (filters.minScore !== undefined) {
      ranked = ranked.filter(
        (r) => r.overallScore !== null && r.overallScore >= filters.minScore!,
      );
    }
    if (filters.recommendation) {
      ranked = ranked.filter(
        (r) => r.recommendation === filters.recommendation,
      );
    }
    if (filters.limit) {
      ranked = ranked.slice(0, filters.limit);
    }
    if (filters.rerank && ranked.length > 1) {
      ranked = await this.llmRerank(job.title, ranked);
    }

    return ranked;
  }

  private pendingSummary(
    cvStatus: string,
    cvProcessingError: string | null,
  ): string {
    switch (cvStatus) {
      case 'FAILED':
        return `CV processing failed: ${cvProcessingError ?? 'unknown error'}`;
      case 'PROCESSING':
        return 'CV is still being processed — scoring will run automatically once it finishes.';
      default:
        return 'Scoring is in progress.';
    }
  }

  /** Best-effort: reorders the top of the list via one LLM call; any failure or malformed response leaves the deterministic order untouched. Unscored candidates are left out of the LLM pass entirely and stay appended at the end. */
  private async llmRerank(
    jobTitle: string,
    candidates: RankedCandidate[],
  ): Promise<RankedCandidate[]> {
    const scored = candidates.filter((c) => c.overallScore !== null);
    const unscored = candidates.filter((c) => c.overallScore === null);
    const top = scored.slice(0, 10);
    const rest = scored.slice(10);

    const listing = top
      .map(
        (c, i) =>
          `${i + 1}. ${c.candidateName ?? c.candidateProfileId} — score ${c.overallScore}: ${c.summary}`,
      )
      .join('\n');

    try {
      const result = await this.llm.chat(
        [
          { role: 'system', content: RERANK_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Job: ${jobTitle}\n\nCandidates:\n${listing}`,
          },
        ],
        { jsonResponse: true },
      );

      const parsed = JSON.parse(result.message.content ?? '{}') as {
        order?: number[];
      };
      const order = parsed.order;
      if (!Array.isArray(order) || order.length !== top.length) {
        return candidates;
      }

      const reordered = order
        .map((n) => top[n - 1])
        .filter((c): c is RankedCandidate => c !== undefined);
      return reordered.length === top.length
        ? [...reordered, ...rest, ...unscored]
        : candidates;
    } catch {
      return candidates;
    }
  }
}
