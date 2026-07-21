import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmClientService } from '../shared/llm/llm-client.service';

export interface RankedCandidate {
  applicationId: string;
  candidateProfileId: string;
  candidateName: string | null;
  overallScore: number;
  recommendation: string;
  confidence: string;
  summary: string;
  processedAt: Date;
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
    });

    let ranked: RankedCandidate[] = applications
      .filter((app) => app.matchResults.length > 0)
      .map((app) => {
        const latest = app.matchResults[0];
        const extracted = app.candidateProfile.extractedDataJson as {
          name?: string;
        } | null;
        return {
          applicationId: app.id,
          candidateProfileId: app.candidateProfileId,
          candidateName: extracted?.name ?? null,
          overallScore: Number(latest.overallScore),
          recommendation: latest.recommendation,
          confidence: latest.confidence,
          summary: latest.summary,
          processedAt: latest.processedAt,
        };
      })
      .sort((a, b) => b.overallScore - a.overallScore);

    if (filters.minScore !== undefined) {
      ranked = ranked.filter((r) => r.overallScore >= filters.minScore!);
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

  /** Best-effort: reorders the top of the list via one LLM call; any failure or malformed response leaves the deterministic order untouched. */
  private async llmRerank(
    jobTitle: string,
    candidates: RankedCandidate[],
  ): Promise<RankedCandidate[]> {
    const top = candidates.slice(0, 10);
    const rest = candidates.slice(10);

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
        ? [...reordered, ...rest]
        : candidates;
    } catch {
      return candidates;
    }
  }
}
