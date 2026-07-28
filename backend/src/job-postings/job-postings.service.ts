import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { resolveCandidateIdentity } from '../candidates/candidate-identity.util';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { AppStatus } from '../generated/prisma/enums';
import { EmailService } from '../shared/email/email.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobPostingDto } from './dto/create-job-posting.dto';
import { UpdateJobPostingDto } from './dto/update-job-posting.dto';

// Applications still "in flight" when a job posting closes — a candidate
// who already reached a terminal outcome (selected, rejected, hired, next
// round, withdrawn, screened out, or interview-expired) keeps that outcome;
// only these get swept into a bulk rejection.
const IN_FLIGHT_APPLICATION_STATUSES: AppStatus[] = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW_PENDING',
  'IN_REVIEW',
  'MANAGER_REVIEW',
  'MANAGER_REVIEWED',
];

// How long a same-actor/same-title DRAFT is treated as "still the same
// in-progress assistant conversation" for create()'s duplicate-draft guard —
// generous enough to cover a multi-message back-and-forth without merging
// two genuinely separate later requests that happen to reuse identical
// wording.
const DUPLICATE_DRAFT_WINDOW_MS = 2 * 60 * 60 * 1000;

// Shared shape instructions for the candidate-facing summary, used by both
// the combined drafting prompt and the standalone re-summarize prompt so the
// two paths can never drift into different lengths/styles. Responsibilities
// and required/preferred skills are shown to candidates as their own
// structured sections (see PublicJobPostingDto), so this summary only needs
// to carry the narrative overview, not restate them.
const CANDIDATE_SUMMARY_SHAPE = `2-3 short paragraphs (roughly 100-180 words total), separated by a blank line ("\\n\\n") between paragraphs, covering: a role overview, what the day-to-day work looks like, and the kind of team/projects they'd work with. Do not restate the work arrangement/location or list specific required skills here — those are shown separately.`;

const JD_DRAFTING_SYSTEM_PROMPT = `You draft job postings for an HR recruitment system. Ground every claim about the
company's technology stack, benefits, culture, and hiring standards in the provided company document excerpts.
Never invent a benefit, technology, salary figure, or work arrangement that isn't in the excerpts or the HR request.
Use inclusive, non-discriminatory language and never mention protected characteristics
(age, gender, religion, ethnicity, nationality, marital status, disability).

Return ONLY a JSON object: { "description": string, "responsibilities": string[], "candidateSummary": string }
- "description": plain prose (no headings needed) covering role overview, required qualifications, and work arrangement. This is the full internal posting.
- "responsibilities": 4-8 short bullet-point strings describing day-to-day duties for this role (no leading dashes/bullets in the text itself).
- "candidateSummary": ${CANDIDATE_SUMMARY_SHAPE}`;

const CANDIDATE_SUMMARY_SYSTEM_PROMPT = `You write a candidate-facing summary of a job posting for a recruitment system's public apply page.
Return ONLY a JSON object: { "candidateSummary": string } — ${CANDIDATE_SUMMARY_SHAPE}`;

export interface JobPostingWithSkills {
  id: string;
  title: string;
  description: string;
  candidateSummary: string | null;
  responsibilities: string[];
  status: string;
  requiredSkills: string[];
  preferredSkills: string[];
  experienceMin: number;
  salaryMax: number | null;
  deadline: Date;
  hiringTarget: number;
  hiredCount: number;
  location: string | null;
  seniority: string | null;
  workModel: string | null;
  createdByUserId: string;
  createdAt: Date;
}

@Injectable()
export class JobPostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentRetrieval: DocumentRetrievalService,
    private readonly llm: LlmClientService,
    private readonly embeddings: EmbeddingsService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
  ) {}

  async create(
    dto: CreateJobPostingDto,
    createdByUserId: string,
  ): Promise<JobPostingWithSkills> {
    // The recruitment assistant is stateless across chat turns (see
    // AssistantOrchestratorService) and re-decides on every message whether
    // it has "enough" info to call createJobPosting — if it asks HR several
    // clarifying questions across separate messages instead of gathering
    // them all before calling the tool once, each answer can trigger another
    // full createJobPosting call. Without this guard, that produces one
    // duplicate DRAFT Job row per follow-up message instead of one job with
    // its details filled in incrementally. Same actor + same (trimmed,
    // case-insensitive) title + still a DRAFT + recent = treated as the same
    // in-progress request and updated in place rather than inserted again.
    // Previously matched on exact rawPrompt text instead of title, but the
    // assistant regenerates that "verbatim" text itself on every call rather
    // than replaying a stored string, so it routinely comes back
    // byte-different between calls (e.g. "Lahore, Pakistan" vs "Lahore
    // Pakistan") and the guard never actually matched. Title is what HR
    // actually asked for and is far more stable across the same
    // conversation.
    const duplicate = await this.findRecentDuplicateDraft(
      dto.title,
      createdByUserId,
    );
    if (duplicate) {
      return this.overwriteDraft(duplicate.id, dto, createdByUserId);
    }

    const { description, responsibilities, candidateSummary } =
      await this.resolveContent(dto);

    const job = await this.prisma.job.create({
      data: {
        title: dto.title,
        rawPrompt: dto.rawPrompt,
        generatedDescription: description,
        description,
        responsibilities,
        candidateSummary,
        experienceMin: dto.experienceMin,
        salaryMax: dto.salaryMax,
        deadline: new Date(dto.deadline),
        hiringTarget: dto.hiringTarget,
        location: dto.location,
        seniority: dto.seniority,
        workModel: dto.workModel,
        createdByUserId,
        status: 'DRAFT',
      },
    });

    await this.syncSkills(job.id, dto.requiredSkills ?? [], true);
    await this.syncSkills(job.id, dto.preferredSkills ?? [], false);
    await this.refreshEmbedding(job.id);

    await this.audit.record({
      actorUserId: createdByUserId,
      action: 'job_posting.created',
      resourceType: 'Job',
      resourceId: job.id,
      details: { title: dto.title },
    });

    return this.getById(job.id);
  }

  private async resolveContent(dto: CreateJobPostingDto): Promise<{
    description: string;
    responsibilities: string[];
    candidateSummary: string | null;
  }> {
    const hrSuppliedDescription = dto.description?.trim();
    return hrSuppliedDescription
      ? {
          description: hrSuppliedDescription,
          responsibilities: dto.responsibilities ?? [],
          candidateSummary: await this.summarizeForCandidates(
            hrSuppliedDescription,
          ),
        }
      : this.draftDescription(dto);
  }

  private async findRecentDuplicateDraft(
    title: string,
    createdByUserId: string,
  ) {
    const cutoff = new Date(Date.now() - DUPLICATE_DRAFT_WINDOW_MS);
    return this.prisma.job.findFirst({
      where: {
        createdByUserId,
        title: { equals: title.trim(), mode: 'insensitive' },
        status: 'DRAFT',
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Re-drafts an already-created DRAFT in place instead of inserting a new
   * Job row — see the duplicate-request guard in create(). Always
   * regenerates description/responsibilities/candidateSummary and fully
   * replaces the skill lists, since each createJobPosting call is meant to
   * carry HR's complete current picture of the role, not an incremental
   * patch (unlike updateJobPosting, which is patch-semantics by design).
   */
  private async overwriteDraft(
    jobId: string,
    dto: CreateJobPostingDto,
    actorUserId: string,
  ): Promise<JobPostingWithSkills> {
    const { description, responsibilities, candidateSummary } =
      await this.resolveContent(dto);

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        title: dto.title,
        generatedDescription: description,
        description,
        responsibilities,
        candidateSummary,
        experienceMin: dto.experienceMin,
        salaryMax: dto.salaryMax,
        deadline: new Date(dto.deadline),
        hiringTarget: dto.hiringTarget,
        location: dto.location,
        seniority: dto.seniority,
        workModel: dto.workModel,
      },
    });

    await this.syncSkills(jobId, dto.requiredSkills ?? [], true);
    await this.syncSkills(jobId, dto.preferredSkills ?? [], false);
    await this.refreshEmbedding(jobId);

    await this.audit.record({
      actorUserId,
      action: 'job_posting.redrafted',
      resourceType: 'Job',
      resourceId: jobId,
      details: { title: dto.title },
    });

    return this.getById(jobId);
  }

  async update(
    id: string,
    changes: UpdateJobPostingDto,
    actorUserId: string,
  ): Promise<JobPostingWithSkills> {
    const current = await this.getById(id); // throws NotFoundException if missing

    // The "assign a Hiring Manager before publishing" rule used to be
    // enforced only in publish() — this generic PATCH path (also the exact
    // method the assistant's updateJobPosting tool calls) could set
    // status: 'PUBLISHED' directly and skip it entirely. Sharing the same
    // guard here closes that gap regardless of which write path is used.
    if (changes.status === 'PUBLISHED' && current.status !== 'PUBLISHED') {
      await this.assertHiringManagerAssigned(id);
    }

    const candidateSummary =
      changes.description !== undefined
        ? await this.summarizeForCandidates(changes.description)
        : undefined;

    await this.prisma.job.update({
      where: { id },
      data: {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.description !== undefined
          ? { description: changes.description, candidateSummary }
          : {}),
        ...(changes.responsibilities !== undefined
          ? { responsibilities: changes.responsibilities }
          : {}),
        ...(changes.experienceMin !== undefined
          ? { experienceMin: changes.experienceMin }
          : {}),
        ...(changes.salaryMax !== undefined
          ? { salaryMax: changes.salaryMax }
          : {}),
        ...(changes.deadline !== undefined
          ? { deadline: new Date(changes.deadline) }
          : {}),
        ...(changes.hiringTarget !== undefined
          ? { hiringTarget: changes.hiringTarget }
          : {}),
        ...(changes.location !== undefined
          ? { location: changes.location }
          : {}),
        ...(changes.seniority !== undefined
          ? { seniority: changes.seniority }
          : {}),
        ...(changes.workModel !== undefined
          ? { workModel: changes.workModel }
          : {}),
        ...(changes.status !== undefined
          ? {
              status: changes.status,
              // Mirrors publish()/pause()'s own timestamp bookkeeping so a
              // status change routed through this generic path doesn't
              // silently skip it.
              ...(changes.status === 'PUBLISHED' &&
              current.status !== 'PUBLISHED'
                ? { portalPublishedAt: new Date() }
                : {}),
              ...(changes.status === 'PAUSED' && current.status !== 'PAUSED'
                ? { portalUnpublishedAt: new Date() }
                : {}),
            }
          : {}),
      },
    });

    if (changes.requiredSkills !== undefined) {
      await this.syncSkills(id, changes.requiredSkills, true);
    }
    if (changes.preferredSkills !== undefined) {
      await this.syncSkills(id, changes.preferredSkills, false);
    }
    if (changes.description !== undefined) {
      await this.refreshEmbedding(id);
    }

    await this.audit.record({
      actorUserId,
      action: 'job_posting.updated',
      resourceType: 'Job',
      resourceId: id,
      details: { changes },
    });

    return this.getById(id);
  }

  async publish(
    id: string,
    actorUserId: string,
  ): Promise<JobPostingWithSkills> {
    const job = await this.getById(id);
    if (job.status !== 'PUBLISHED') {
      await this.assertHiringManagerAssigned(id);

      await this.prisma.job.update({
        where: { id },
        data: { status: 'PUBLISHED', portalPublishedAt: new Date() },
      });
      await this.audit.record({
        actorUserId,
        action: 'job_posting.published',
        resourceType: 'Job',
        resourceId: id,
      });
    }
    return this.getById(id);
  }

  /**
   * Immediately hides the posting from the public /jobs list (only
   * status='PUBLISHED' postings are ever returned there) while leaving every
   * Application/interview/candidate record untouched — resumable later.
   */
  async pause(id: string, actorUserId: string): Promise<JobPostingWithSkills> {
    const job = await this.getById(id);
    if (job.status === 'PAUSED') return job;
    if (job.status !== 'PUBLISHED') {
      throw new BadRequestException(
        `Only a published job posting can be paused (current status: ${job.status}).`,
      );
    }

    await this.prisma.job.update({
      where: { id },
      data: { status: 'PAUSED', portalUnpublishedAt: new Date() },
    });
    await this.audit.record({
      actorUserId,
      action: 'job_posting.paused',
      resourceType: 'Job',
      resourceId: id,
    });
    return this.getById(id);
  }

  async resume(id: string, actorUserId: string): Promise<JobPostingWithSkills> {
    const job = await this.getById(id);
    if (job.status === 'PUBLISHED') return job;
    if (job.status !== 'PAUSED') {
      throw new BadRequestException(
        `Only a paused job posting can be resumed (current status: ${job.status}).`,
      );
    }

    await this.prisma.job.update({
      where: { id },
      data: { status: 'PUBLISHED', portalPublishedAt: new Date() },
    });
    await this.audit.record({
      actorUserId,
      action: 'job_posting.resumed',
      resourceType: 'Job',
      resourceId: id,
    });
    return this.getById(id);
  }

  /**
   * Hides the posting from the public list and stops taking new applicants,
   * with real side effects (unlike the old bare status-field PATCH): stamps
   * portalUnpublishedAt, and bulk-rejects every application still in flight
   * with a BULK_REJECTION email — a candidate whose application already
   * reached a real outcome (selected/hired/rejected/etc.) is left alone.
   */
  async close(id: string, actorUserId: string): Promise<JobPostingWithSkills> {
    const job = await this.getById(id);
    if (job.status === 'CLOSED') return job;
    if (job.status === 'ARCHIVED') {
      throw new BadRequestException(
        `Cannot close an archived job posting (current status: ${job.status}).`,
      );
    }

    await this.prisma.job.update({
      where: { id },
      data: { status: 'CLOSED', portalUnpublishedAt: new Date() },
    });
    await this.bulkRejectInFlightApplications(id, job.title, actorUserId);
    await this.audit.record({
      actorUserId,
      action: 'job_posting.closed',
      resourceType: 'Job',
      resourceId: id,
    });
    return this.getById(id);
  }

  /** Archives a closed posting — purely a status change, no further side effects (the bulk rejection already happened at close time). */
  async archive(
    id: string,
    actorUserId: string,
  ): Promise<JobPostingWithSkills> {
    const job = await this.getById(id);
    if (job.status === 'ARCHIVED') return job;
    if (job.status !== 'CLOSED') {
      throw new BadRequestException(
        `Only a closed job posting can be archived (current status: ${job.status}).`,
      );
    }

    await this.prisma.job.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    await this.audit.record({
      actorUserId,
      action: 'job_posting.archived',
      resourceType: 'Job',
      resourceId: id,
    });
    return this.getById(id);
  }

  /**
   * Called once per successful offer letter (see HiringDecisionsService.
   * sendOfferLetter) — the only place Job.hiredCount is ever incremented.
   * Auto-closes (with the same bulk-rejection side effects as a manual
   * close()) the moment the hiring target is met, per the schema's own
   * "hit hiring target -> auto-close and bulk-reject remaining candidates"
   * comment on BULK_REJECTION/hiredCount.
   */
  async incrementHiredCountAndMaybeAutoClose(
    id: string,
    actorUserId: string,
  ): Promise<void> {
    const job = await this.prisma.job.update({
      where: { id },
      data: { hiredCount: { increment: 1 } },
    });
    if (job.hiredCount >= job.hiringTarget && job.status === 'PUBLISHED') {
      await this.close(id, actorUserId);
    }
  }

  private async bulkRejectInFlightApplications(
    jobId: string,
    jobTitle: string,
    actorUserId: string,
  ): Promise<void> {
    const applications = await this.prisma.application.findMany({
      where: { jobId, status: { in: IN_FLIGHT_APPLICATION_STATUSES } },
      include: { candidateProfile: true },
    });

    for (const application of applications) {
      await this.prisma.application.update({
        where: { id: application.id },
        data: { status: 'REJECTED' },
      });

      const { name: candidateName, email: candidateEmail } =
        resolveCandidateIdentity(application.candidateProfile);
      const sent = await this.email.send({
        to: candidateEmail,
        type: 'BULK_REJECTION',
        variables: { candidateName, jobTitle },
      });
      if (sent) {
        await this.prisma.emailLog.create({
          data: {
            applicationId: application.id,
            type: 'BULK_REJECTION',
            triggeredByUserId: actorUserId,
          },
        });
      }
    }
  }

  /**
   * Permanently removes the posting and everything tied to it — every
   * Application against it, and (via Application's own cascade) each one's
   * AIInterviewSession/AIInterviewQuestion/CandidateSkillGrade, EmailLog, and
   * MatchResult rows, plus JobSkill/LinkedInPost/JobPostingHiringManager/
   * CandidateComment — all handled by onDelete: Cascade at the DB level, so
   * a single job.delete() is sufficient here.
   */
  async delete(id: string, actorUserId: string): Promise<void> {
    const job = await this.getById(id); // throws NotFoundException if missing

    await this.audit.record({
      actorUserId,
      action: 'job_posting.deleted',
      resourceType: 'Job',
      resourceId: id,
      details: { title: job.title, status: job.status },
    });

    await this.prisma.job.delete({ where: { id } });
  }

  async getById(id: string): Promise<JobPostingWithSkills> {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { jobSkills: { include: { skill: true } } },
    });
    if (!job) {
      throw new NotFoundException(`No job posting found with id "${id}".`);
    }
    return toJobPostingWithSkills(job);
  }

  async list(filter: {
    status?: string;
    /** When set (Hiring Managers), only jobs this user is assigned to are returned. */
    assignedToUserId?: string;
    /** Case-insensitive title search, pushed to the DB instead of the staff UI filtering an already-fetched full list. */
    search?: string;
    /** 1-based page number; requires pageSize to take effect. */
    page?: number;
    pageSize?: number;
  }): Promise<JobPostingWithSkills[]> {
    const pageSize = filter.pageSize;
    const page = filter.page && filter.page > 0 ? filter.page : 1;

    const jobs = await this.prisma.job.findMany({
      where: {
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.assignedToUserId
          ? {
              hiringManagers: {
                some: { hiringManagerUserId: filter.assignedToUserId },
              },
            }
          : {}),
        ...(filter.search
          ? { title: { contains: filter.search, mode: 'insensitive' } }
          : {}),
      },
      include: { jobSkills: { include: { skill: true } } },
      orderBy: { createdAt: 'desc' },
      ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    });
    return jobs.map(toJobPostingWithSkills);
  }

  /** Shared by publish() and update() (status -> PUBLISHED) so the rule can't be bypassed by whichever write path is used. */
  private async assertHiringManagerAssigned(id: string): Promise<void> {
    const hiringManagerCount = await this.prisma.jobPostingHiringManager.count({
      where: { jobId: id },
    });
    if (hiringManagerCount === 0) {
      throw new BadRequestException(
        'Assign at least one Hiring Manager before publishing this job posting.',
      );
    }
  }

  /**
   * Case-insensitive lookup by title for the assistant's job-lookup tool —
   * lets HR refer to "the Backend Developer role" by name instead of
   * needing to recall/re-paste a raw UUID across conversation turns.
   */
  async search(query: string): Promise<JobPostingWithSkills[]> {
    const jobs = await this.prisma.job.findMany({
      where: { title: { contains: query, mode: 'insensitive' } },
      include: { jobSkills: { include: { skill: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return jobs.map(toJobPostingWithSkills);
  }

  private async draftDescription(dto: CreateJobPostingDto): Promise<{
    description: string;
    responsibilities: string[];
    candidateSummary: string | null;
  }> {
    const policyChunks = await this.documentRetrieval.retrieve(
      `${dto.title}. ${dto.rawPrompt}`,
      6,
    );
    const context =
      policyChunks.length > 0
        ? policyChunks
            .map((chunk) => `[${chunk.documentName}]\n${chunk.content}`)
            .join('\n\n---\n\n')
        : '(No matching company documents found.)';

    const requirementsLine = [
      dto.requiredSkills?.length
        ? `Required skills: ${dto.requiredSkills.join(', ')}.`
        : '',
      dto.preferredSkills?.length
        ? `Preferred skills: ${dto.preferredSkills.join(', ')}.`
        : '',
      `Minimum experience: ${dto.experienceMin} years.`,
      dto.location ? `Location: ${dto.location}.` : '',
      dto.seniority ? `Seniority: ${dto.seniority}.` : '',
      dto.workModel ? `Work model: ${dto.workModel}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const result = await this.llm.chat(
      [
        { role: 'system', content: JD_DRAFTING_SYSTEM_PROMPT },
        {
          role: 'system',
          content: `Company document excerpts:\n\n${context}`,
        },
        {
          role: 'user',
          content: `Draft a job posting for "${dto.title}". HR's request: "${dto.rawPrompt}". ${requirementsLine}`,
        },
      ],
      { jsonResponse: true },
    );

    const parsed = parseDraftResult(result.message.content);
    return {
      description: parsed?.description || dto.rawPrompt,
      responsibilities: parsed?.responsibilities ?? [],
      candidateSummary: parsed?.candidateSummary ?? null,
    };
  }

  /** Used when HR supplies their own description directly (draftDescription/its JSON-mode call never runs in that path). */
  private async summarizeForCandidates(
    description: string,
  ): Promise<string | null> {
    const result = await this.llm.chat(
      [
        { role: 'system', content: CANDIDATE_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: description },
      ],
      { jsonResponse: true },
    );
    try {
      const parsed = JSON.parse(result.message.content ?? '{}') as {
        candidateSummary?: string;
      };
      return parsed.candidateSummary?.trim() || null;
    } catch {
      return null;
    }
  }

  private async refreshEmbedding(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
    });
    const embedding = await this.embeddings.embed(
      `${job.title}\n\n${job.description}`,
    );
    const vectorLiteral = this.embeddings.toVectorLiteral(embedding);
    await this.prisma
      .$executeRaw`UPDATE "Job" SET embedding = ${vectorLiteral}::vector WHERE id = ${jobId}`;
  }

  /**
   * Replaces the full required (or preferred) skill set for this job — not
   * just an additive upsert. Without the delete step, PATCHing
   * requiredSkills/preferredSkills would only ever grow the list: stale
   * skills from a previous edit (or a bad initial value) would stick around
   * forever and keep dragging the scoring algorithm's required/preferred
   * buckets down against the names the caller actually intended to replace.
   */
  private async syncSkills(
    jobId: string,
    skillNames: string[],
    required: boolean,
  ): Promise<void> {
    const skillIds: string[] = [];
    for (const rawName of skillNames) {
      const name = rawName.trim();
      if (!name) continue;

      const skill = await this.prisma.skill.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      skillIds.push(skill.id);

      await this.prisma.jobSkill.upsert({
        where: { jobId_skillId: { jobId, skillId: skill.id } },
        update: { required },
        create: { jobId, skillId: skill.id, required },
      });
    }

    await this.prisma.jobSkill.deleteMany({
      where: {
        jobId,
        required,
        skillId: { notIn: skillIds },
      },
    });
  }
}

function parseDraftResult(content: string | null | undefined): {
  description: string;
  responsibilities: string[];
  candidateSummary: string | null;
} | null {
  try {
    const parsed = JSON.parse(content ?? '{}') as {
      description?: string;
      responsibilities?: string[];
      candidateSummary?: string;
    };
    if (!parsed.description?.trim()) return null;
    return {
      description: parsed.description.trim(),
      responsibilities: Array.isArray(parsed.responsibilities)
        ? parsed.responsibilities.map((r) => r.trim()).filter(Boolean)
        : [],
      candidateSummary: parsed.candidateSummary?.trim() || null,
    };
  } catch {
    return null;
  }
}

interface JobWithSkillsRow {
  id: string;
  title: string;
  description: string;
  candidateSummary: string | null;
  responsibilities: unknown;
  status: string;
  experienceMin: number;
  salaryMax: number | null;
  deadline: Date;
  hiringTarget: number;
  hiredCount: number;
  location: string | null;
  seniority: string | null;
  workModel: string | null;
  createdByUserId: string;
  createdAt: Date;
  jobSkills: { required: boolean; skill: { name: string } }[];
}

function toJobPostingWithSkills(job: JobWithSkillsRow): JobPostingWithSkills {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    candidateSummary: job.candidateSummary,
    responsibilities: Array.isArray(job.responsibilities)
      ? (job.responsibilities as string[])
      : [],
    status: job.status,
    requiredSkills: job.jobSkills
      .filter((js) => js.required)
      .map((js) => js.skill.name),
    preferredSkills: job.jobSkills
      .filter((js) => !js.required)
      .map((js) => js.skill.name),
    experienceMin: job.experienceMin,
    salaryMax: job.salaryMax,
    deadline: job.deadline,
    hiringTarget: job.hiringTarget,
    hiredCount: job.hiredCount,
    location: job.location,
    seniority: job.seniority,
    workModel: job.workModel,
    createdByUserId: job.createdByUserId,
    createdAt: job.createdAt,
  };
}
