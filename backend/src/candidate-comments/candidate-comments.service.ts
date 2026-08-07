import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CandidateCommentView {
  id: string;
  candidateId: string;
  jobPostingId: string;
  authorUserId: string;
  /** The commenting Hiring Manager's display name — several may be assigned to the same job posting, so a comment without this is unattributed. */
  authorName: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CommentWithAuthor {
  id: string;
  candidateId: string;
  jobPostingId: string;
  authorUserId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: { firstName: string; lastName: string };
}

function toView(comment: CommentWithAuthor): CandidateCommentView {
  const { author, ...rest } = comment;
  return { ...rest, authorName: `${author.firstName} ${author.lastName}`.trim() };
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
      include: { author: { select: { firstName: true, lastName: true } } },
    });

    await this.audit.record({
      actorUserId: authorUserId,
      action: 'candidate_comment.created',
      resourceType: 'CandidateComment',
      resourceId: comment.id,
      details: { candidateId, jobPostingId },
    });

    return toView(comment);
  }

  async list(
    candidateId: string,
    jobPostingId: string,
  ): Promise<CandidateCommentView[]> {
    const comments = await this.prisma.candidateComment.findMany({
      where: { candidateId, jobPostingId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { firstName: true, lastName: true } } },
    });
    return comments.map(toView);
  }
}
