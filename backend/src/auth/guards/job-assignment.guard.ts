import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JOB_ID_PARAM_KEY } from '../decorators/job-id-param.decorator';

const DEFAULT_PARAM = 'jobPostingId';

/**
 * Job-posting-scoped permission guard (RBAC requirement 6/2c): SUPER_ADMIN
 * and HR_ADMIN pass unconditionally (their role already grants org-wide
 * access via RolesGuard); HIRING_MANAGER must have an explicit
 * JobPostingHiringManager row for the job posting named in the route.
 * Always used alongside RolesGuard, never in place of it.
 */
@Injectable()
export class JobAssignmentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }

    if (user.role !== 'HIRING_MANAGER') {
      return true;
    }

    const paramName =
      this.reflector.getAllAndOverride<string | undefined>(JOB_ID_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_PARAM;

    const rawParam = request.params[paramName];
    const jobPostingId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    if (!jobPostingId) {
      throw new ForbiddenException('You are not assigned to this job posting.');
    }

    const assignment = await this.prisma.jobPostingHiringManager.findUnique({
      where: {
        jobId_hiringManagerUserId: {
          jobId: jobPostingId,
          hiringManagerUserId: user.id,
        },
      },
    });

    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this job posting.');
    }

    return true;
  }
}
