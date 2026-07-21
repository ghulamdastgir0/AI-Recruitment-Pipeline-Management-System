import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CandidateCommentView {
  id: string;
  candidateId: string;
  jobPostingId: string;
  authorUserId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CandidateCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async add(
    candidateId: string,
    jobPostingId: string,
    authorUserId: string,
    content: string,
  ): Promise<CandidateCommentView> {
    const application = await this.prisma.application.findUnique({
      where: {
        candidateProfileId_jobId: {
          candidateProfileId: candidateId,
          jobId: jobPostingId,
        },
      },
    });
    if (!application) {
      throw new NotFoundException(
        `No candidate "${candidateId}" found against job posting "${jobPostingId}".`,
      );
    }

    const comment = await this.prisma.candidateComment.create({
      data: { candidateId, jobPostingId, authorUserId, content },
    });

    await this.audit.record({
      actorUserId: authorUserId,
      action: 'candidate_comment.created',
      resourceType: 'CandidateComment',
      resourceId: comment.id,
      details: { candidateId, jobPostingId },
    });

    return comment;
  }

  async list(
    candidateId: string,
    jobPostingId: string,
  ): Promise<CandidateCommentView[]> {
    return this.prisma.candidateComment.findMany({
      where: { candidateId, jobPostingId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
