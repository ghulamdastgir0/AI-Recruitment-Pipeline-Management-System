import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobPostingDto } from './dto/create-job-posting.dto';
import { UpdateJobPostingDto } from './dto/update-job-posting.dto';

const JD_DRAFTING_SYSTEM_PROMPT = `You draft job postings for an HR recruitment system. Ground every claim about the
company's technology stack, benefits, culture, and hiring standards in the provided company document excerpts.
Never invent a benefit, technology, salary figure, or work arrangement that isn't in the excerpts or the HR request.
Write plain prose (no headings needed) covering: role overview, responsibilities, required qualifications, and
work arrangement. Use inclusive, non-discriminatory language and never mention protected characteristics
(age, gender, religion, ethnicity, nationality, marital status, disability).`;

export interface JobPostingWithSkills {
  id: string;
  title: string;
  description: string;
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
  ) {}

  async create(
    dto: CreateJobPostingDto,
    createdByUserId: string,
  ): Promise<JobPostingWithSkills> {
    const description =
      dto.description?.trim() || (await this.draftDescription(dto));

    const job = await this.prisma.job.create({
      data: {
        title: dto.title,
        rawPrompt: dto.rawPrompt,
        generatedDescription: description,
        description,
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

  async update(
    id: string,
    changes: UpdateJobPostingDto,
    actorUserId: string,
  ): Promise<JobPostingWithSkills> {
    await this.getById(id); // throws NotFoundException if missing

    await this.prisma.job.update({
      where: { id },
      data: {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.description !== undefined
          ? { description: changes.description }
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
        ...(changes.status !== undefined ? { status: changes.status } : {}),
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
  }): Promise<JobPostingWithSkills[]> {
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
      },
      include: { jobSkills: { include: { skill: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map(toJobPostingWithSkills);
  }

  private async draftDescription(dto: CreateJobPostingDto): Promise<string> {
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

    const result = await this.llm.chat([
      { role: 'system', content: JD_DRAFTING_SYSTEM_PROMPT },
      { role: 'system', content: `Company document excerpts:\n\n${context}` },
      {
        role: 'user',
        content: `Draft a job posting for "${dto.title}". HR's request: "${dto.rawPrompt}". ${requirementsLine}`,
      },
    ]);

    return result.message.content?.trim() || dto.rawPrompt;
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

interface JobWithSkillsRow {
  id: string;
  title: string;
  description: string;
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
