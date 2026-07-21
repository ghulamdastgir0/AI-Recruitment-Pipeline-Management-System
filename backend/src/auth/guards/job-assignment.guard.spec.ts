import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { JobAssignmentGuard } from './job-assignment.guard';

function buildContext(
  user: { id: string; role: string } | undefined,
  params: Record<string, string>,
) {
  const request = { user, params };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(paramNameOverride?: string) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(paramNameOverride),
  } as unknown as jest.Mocked<Reflector>;
  const prisma = {
    jobPostingHiringManager: { findUnique: jest.fn() },
  } as unknown as jest.Mocked<PrismaService>;
  return { guard: new JobAssignmentGuard(reflector, prisma), prisma };
}

describe('JobAssignmentGuard', () => {
  it('lets SUPER_ADMIN through regardless of assignment', async () => {
    const { guard, prisma } = buildGuard();
    const context = buildContext(
      { id: 'admin-1', role: 'SUPER_ADMIN' },
      { jobPostingId: 'job-1' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.jobPostingHiringManager.findUnique).not.toHaveBeenCalled();
  });

  it('lets HR_ADMIN through regardless of assignment', async () => {
    const { guard, prisma } = buildGuard();
    const context = buildContext(
      { id: 'hr-1', role: 'HR_ADMIN' },
      { jobPostingId: 'job-1' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.jobPostingHiringManager.findUnique).not.toHaveBeenCalled();
  });

  it('allows a HIRING_MANAGER with a matching assignment row', async () => {
    const { guard, prisma } = buildGuard();
    (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue({
      id: 'assignment-1',
    });
    const context = buildContext(
      { id: 'hm-1', role: 'HIRING_MANAGER' },
      { jobPostingId: 'job-1' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.jobPostingHiringManager.findUnique).toHaveBeenCalledWith({
      where: {
        jobId_hiringManagerUserId: {
          jobId: 'job-1',
          hiringManagerUserId: 'hm-1',
        },
      },
    });
  });

  it('denies a HIRING_MANAGER with no assignment row', async () => {
    const { guard, prisma } = buildGuard();
    (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue(
      null,
    );
    const context = buildContext(
      { id: 'hm-1', role: 'HIRING_MANAGER' },
      { jobPostingId: 'job-1' },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('honors a custom @JobIdParam route param name', async () => {
    const { guard, prisma } = buildGuard('id');
    (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue({
      id: 'assignment-1',
    });
    const context = buildContext(
      { id: 'hm-1', role: 'HIRING_MANAGER' },
      { id: 'job-42' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.jobPostingHiringManager.findUnique).toHaveBeenCalledWith({
      where: {
        jobId_hiringManagerUserId: {
          jobId: 'job-42',
          hiringManagerUserId: 'hm-1',
        },
      },
    });
  });

  it('denies when there is no authenticated user', async () => {
    const { guard } = buildGuard();
    const context = buildContext(undefined, { jobPostingId: 'job-1' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
