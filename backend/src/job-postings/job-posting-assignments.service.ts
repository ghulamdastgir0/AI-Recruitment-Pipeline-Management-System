import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AssignmentView {
  id: string;
  jobId: string;
  hiringManagerUserId: string;
  assignedByUserId: string;
  assignedAt: Date;
}

@Injectable()
export class JobPostingAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async assign(
    jobId: string,
    hiringManagerUserId: string,
    assignedByUserId: string,
  ): Promise<AssignmentView> {
    const [job, hiringManager] = await Promise.all([
      this.prisma.job.findUnique({ where: { id: jobId } }),
      this.prisma.user.findUnique({ where: { id: hiringManagerUserId } }),
    ]);
    if (!job) {
      throw new NotFoundException(`No job posting found with id "${jobId}".`);
    }
    if (!hiringManager) {
      throw new NotFoundException(
        `No user found with id "${hiringManagerUserId}".`,
      );
    }
    if (hiringManager.role !== 'HIRING_MANAGER') {
      throw new BadRequestException(
        `User "${hiringManagerUserId}" is not a Hiring Manager.`,
      );
    }

    const assignment = await this.prisma.jobPostingHiringManager.upsert({
      where: {
        jobId_hiringManagerUserId: { jobId, hiringManagerUserId },
      },
      update: {},
      create: { jobId, hiringManagerUserId, assignedByUserId },
    });

    await this.audit.record({
      actorUserId: assignedByUserId,
      action: 'job_posting.hiring_manager_assigned',
      resourceType: 'Job',
      resourceId: jobId,
      details: { hiringManagerUserId },
    });

    return assignment;
  }

  async unassign(
    jobId: string,
    hiringManagerUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const assignment = await this.prisma.jobPostingHiringManager.findUnique({
      where: { jobId_hiringManagerUserId: { jobId, hiringManagerUserId } },
    });
    if (!assignment) {
      throw new NotFoundException(
        `No assignment found for hiring manager "${hiringManagerUserId}" on job "${jobId}".`,
      );
    }

    await this.prisma.jobPostingHiringManager.delete({
      where: { jobId_hiringManagerUserId: { jobId, hiringManagerUserId } },
    });

    await this.audit.record({
      actorUserId,
      action: 'job_posting.hiring_manager_unassigned',
      resourceType: 'Job',
      resourceId: jobId,
      details: { hiringManagerUserId },
    });
  }

  async listForJob(jobId: string): Promise<AssignmentView[]> {
    return this.prisma.jobPostingHiringManager.findMany({
      where: { jobId },
      orderBy: { assignedAt: 'desc' },
    });
  }
}
