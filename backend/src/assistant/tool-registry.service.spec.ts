import { AuditLogService } from '../audit/audit-log.service';
import { CandidateCommentsService } from '../candidate-comments/candidate-comments.service';
import { CvUploadService } from '../candidates/services/cv-upload.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { HiringDecisionsService } from '../hiring-decisions/hiring-decisions.service';
import { InterviewSessionService } from '../interviews/services/interview-session.service';
import { JobPostingAssignmentsService } from '../job-postings/job-posting-assignments.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { MatchingService } from '../matching/matching.service';
import { RankingService } from '../matching/ranking.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ToolRegistryService } from './tool-registry.service';

function buildRegistry() {
  const documentRetrieval = {
    retrieve: jest.fn(),
  } as unknown as jest.Mocked<DocumentRetrievalService>;
  const jobPostings = {
    create: jest.fn(),
    update: jest.fn(),
    publish: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    delete: jest.fn(),
    search: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<JobPostingsService>;
  const jobAssignments = {
    assign: jest.fn(),
  } as unknown as jest.Mocked<JobPostingAssignmentsService>;
  const cvUpload = {
    uploadCv: jest.fn(),
    getStatus: jest.fn(),
  } as unknown as jest.Mocked<CvUploadService>;
  const matching = {
    match: jest.fn(),
    getLatestExplanation: jest.fn(),
  } as unknown as jest.Mocked<MatchingService>;
  const ranking = { rank: jest.fn() } as unknown as jest.Mocked<RankingService>;
  const users = {
    findHiringManagerByEmail: jest.fn(),
  } as unknown as jest.Mocked<UsersService>;
  const comments = {
    list: jest.fn(),
    add: jest.fn(),
  } as unknown as jest.Mocked<CandidateCommentsService>;
  const decisions = {
    decide: jest.fn(),
    sendOfferLetter: jest.fn(),
    moveToManagerReview: jest.fn(),
    markManagerReviewed: jest.fn(),
    revertManagerReview: jest.fn(),
  } as unknown as jest.Mocked<HiringDecisionsService>;
  const interviewSessions = {
    getTranscript: jest.fn(),
  } as unknown as jest.Mocked<InterviewSessionService>;
  const prisma = {
    jobPostingHiringManager: { findUnique: jest.fn() },
  } as unknown as jest.Mocked<PrismaService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;

  const registry = new ToolRegistryService(
    documentRetrieval,
    jobPostings,
    jobAssignments,
    cvUpload,
    matching,
    ranking,
    users,
    comments,
    decisions,
    interviewSessions,
    prisma,
    audit,
  );
  return {
    registry,
    documentRetrieval,
    jobPostings,
    jobAssignments,
    cvUpload,
    matching,
    ranking,
    users,
    comments,
    decisions,
    interviewSessions,
    prisma,
    audit,
  };
}

const hrCtx = { actorUserId: 'user-1', actorRole: 'HR_ADMIN' as const };
const managerCtx = { actorUserId: 'mgr-1', actorRole: 'HIRING_MANAGER' as const };

describe('ToolRegistryService', () => {
  describe('isGated', () => {
    it('always gates publishJobPosting', () => {
      const { registry } = buildRegistry();
      expect(
        registry.isGated('publishJobPosting', { jobPostingId: 'job-1' }),
      ).toBe(true);
    });

    it('gates updateJobPosting only when changes includes status', () => {
      const { registry } = buildRegistry();
      expect(
        registry.isGated('updateJobPosting', {
          jobPostingId: 'job-1',
          changes: { status: 'PUBLISHED' },
        }),
      ).toBe(true);
      expect(
        registry.isGated('updateJobPosting', {
          jobPostingId: 'job-1',
          changes: { title: 'New title' },
        }),
      ).toBe(false);
    });

    it('never gates read-only or non-decision tools', () => {
      const { registry } = buildRegistry();
      for (const tool of [
        'searchCompanyPolicies',
        'createJobPosting',
        'uploadCandidateCv',
        'matchCandidateToJob',
        'rankCandidatesForJob',
        'getCandidateMatchExplanation',
        'getCandidateProcessingStatus',
        'pauseJobPosting',
        'resumeJobPosting',
        'findJobPosting',
        'assignHiringManager',
        'listMyJobPostings',
        'listCandidateComments',
        'addCandidateComment',
        'markManagerReviewed',
        'moveToManagerReview',
      ]) {
        expect(registry.isGated(tool, {})).toBe(false);
      }
    });

    it('always gates deleteJobPosting, decideApplication, and sendOfferLetter', () => {
      const { registry } = buildRegistry();
      expect(
        registry.isGated('deleteJobPosting', { jobPostingId: 'job-1' }),
      ).toBe(true);
      expect(registry.isGated('decideApplication', {})).toBe(true);
      expect(registry.isGated('sendOfferLetter', {})).toBe(true);
    });
  });

  describe('execute — role permissions', () => {
    it('refuses an HR-only tool for a HIRING_MANAGER actor', async () => {
      const { registry, jobPostings } = buildRegistry();

      const outcome = await registry.execute(
        'createJobPosting',
        { title: 'x' },
        managerCtx,
      );

      expect(outcome.ok).toBe(false);
      expect((outcome.result as { error: string }).error).toMatch(/not available/i);
      expect(jobPostings.create).not.toHaveBeenCalled();
    });

    it('refuses a manager-only tool for an HR_ADMIN actor', async () => {
      const { registry, comments } = buildRegistry();

      const outcome = await registry.execute(
        'addCandidateComment',
        { candidateId: 'c-1', jobPostingId: 'job-1', content: 'looks good' },
        hrCtx,
      );

      expect(outcome.ok).toBe(false);
      expect(comments.add).not.toHaveBeenCalled();
    });

    it('rejects an unknown tool without throwing', async () => {
      const { registry } = buildRegistry();
      const outcome = await registry.execute('notARealTool', {}, hrCtx);
      expect(outcome.ok).toBe(false);
    });
  });

  describe('execute — job-assignment scoping for Hiring Managers', () => {
    it('refuses a job/candidate-scoped tool when the manager is not assigned to that job posting', async () => {
      const { registry, prisma, ranking } = buildRegistry();
      (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const outcome = await registry.execute(
        'rankCandidatesForJob',
        { jobPostingId: 'job-1' },
        managerCtx,
      );

      expect(outcome.ok).toBe(false);
      expect((outcome.result as { error: string }).error).toMatch(/not assigned/i);
      expect(ranking.rank).not.toHaveBeenCalled();
    });

    it('allows it once the manager is confirmed assigned', async () => {
      const { registry, prisma, ranking } = buildRegistry();
      (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue(
        { jobId: 'job-1', hiringManagerUserId: 'mgr-1' },
      );
      ranking.rank.mockResolvedValue([] as never);

      const outcome = await registry.execute(
        'rankCandidatesForJob',
        { jobPostingId: 'job-1' },
        managerCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(ranking.rank).toHaveBeenCalledWith('job-1', expect.any(Object));
    });

    it('never checks assignment for HR/Admin', async () => {
      const { registry, prisma, ranking } = buildRegistry();
      ranking.rank.mockResolvedValue([] as never);

      await registry.execute('rankCandidatesForJob', { jobPostingId: 'job-1' }, hrCtx);

      expect(prisma.jobPostingHiringManager.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('execute — new manager/review tools', () => {
    it('listMyJobPostings filters to assigned jobs for a Hiring Manager', async () => {
      const { registry, jobPostings } = buildRegistry();
      jobPostings.list.mockResolvedValue([
        { id: 'job-1', title: 'Backend Developer', status: 'PUBLISHED' } as never,
      ]);

      const outcome = await registry.execute('listMyJobPostings', {}, managerCtx);

      expect(outcome.ok).toBe(true);
      expect(jobPostings.list).toHaveBeenCalledWith({ assignedToUserId: 'mgr-1' });
    });

    it('listMyJobPostings returns everything for HR/Admin (no assignedToUserId filter)', async () => {
      const { registry, jobPostings } = buildRegistry();

      await registry.execute('listMyJobPostings', {}, hrCtx);

      expect(jobPostings.list).toHaveBeenCalledWith({ assignedToUserId: undefined });
    });

    it('addCandidateComment delegates to CandidateCommentsService.add for an assigned manager', async () => {
      const { registry, comments, prisma } = buildRegistry();
      (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue(
        { jobId: 'job-1', hiringManagerUserId: 'mgr-1' },
      );
      comments.add.mockResolvedValue({ id: 'comment-1' } as never);

      const outcome = await registry.execute(
        'addCandidateComment',
        { candidateId: 'c-1', jobPostingId: 'job-1', content: 'Strong on SQL.' },
        managerCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(comments.add).toHaveBeenCalledWith('c-1', 'job-1', 'mgr-1', 'Strong on SQL.');
    });

    it('markManagerReviewed delegates to HiringDecisionsService for an assigned manager', async () => {
      const { registry, decisions, prisma } = buildRegistry();
      (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue(
        { jobId: 'job-1', hiringManagerUserId: 'mgr-1' },
      );
      decisions.markManagerReviewed.mockResolvedValue({
        applicationId: 'app-1',
        status: 'MANAGER_REVIEWED',
      } as never);

      const outcome = await registry.execute(
        'markManagerReviewed',
        { candidateId: 'c-1', jobPostingId: 'job-1', comment: 'Good fit.' },
        managerCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(decisions.markManagerReviewed).toHaveBeenCalledWith(
        'c-1',
        'job-1',
        'mgr-1',
        'Good fit.',
      );
    });

    it('revertManagerReview delegates to HiringDecisionsService for an assigned manager', async () => {
      const { registry, decisions, prisma } = buildRegistry();
      (prisma.jobPostingHiringManager.findUnique as jest.Mock).mockResolvedValue(
        { jobId: 'job-1', hiringManagerUserId: 'mgr-1' },
      );
      decisions.revertManagerReview.mockResolvedValue({
        applicationId: 'app-1',
        status: 'MANAGER_REVIEW',
      } as never);

      const outcome = await registry.execute(
        'revertManagerReview',
        { candidateId: 'c-1', jobPostingId: 'job-1' },
        managerCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(decisions.revertManagerReview).toHaveBeenCalledWith('c-1', 'job-1', 'mgr-1');
    });

    it('decideApplication delegates to HiringDecisionsService.decide for HR', async () => {
      const { registry, decisions } = buildRegistry();
      decisions.decide.mockResolvedValue({
        applicationId: 'app-1',
        status: 'SELECTED',
        emailSent: true,
      } as never);

      const outcome = await registry.execute(
        'decideApplication',
        { candidateId: 'c-1', jobPostingId: 'job-1', decision: 'SELECTED' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(decisions.decide).toHaveBeenCalledWith('c-1', 'job-1', 'user-1', {
        decision: 'SELECTED',
        nextRoundTime: undefined,
        nextRoundDeadline: undefined,
      });
    });

    it('sendOfferLetter delegates to HiringDecisionsService.sendOfferLetter for HR', async () => {
      const { registry, decisions } = buildRegistry();
      decisions.sendOfferLetter.mockResolvedValue({
        applicationId: 'app-1',
        status: 'HIRED',
        emailSent: true,
      } as never);

      const outcome = await registry.execute(
        'sendOfferLetter',
        { candidateId: 'c-1', jobPostingId: 'job-1', offerDetails: '$100k' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(decisions.sendOfferLetter).toHaveBeenCalledWith(
        'c-1',
        'job-1',
        'user-1',
        '$100k',
      );
    });
  });

  describe('execute — new job-posting tools', () => {
    it('pauseJobPosting delegates to jobPostings.pause', async () => {
      const { registry, jobPostings } = buildRegistry();
      jobPostings.pause.mockResolvedValue({ id: 'job-1', status: 'PAUSED' } as never);

      const outcome = await registry.execute(
        'pauseJobPosting',
        { jobPostingId: 'job-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(jobPostings.pause).toHaveBeenCalledWith('job-1', 'user-1');
    });

    it('resumeJobPosting delegates to jobPostings.resume', async () => {
      const { registry, jobPostings } = buildRegistry();
      jobPostings.resume.mockResolvedValue({ id: 'job-1', status: 'PUBLISHED' } as never);

      const outcome = await registry.execute(
        'resumeJobPosting',
        { jobPostingId: 'job-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(jobPostings.resume).toHaveBeenCalledWith('job-1', 'user-1');
    });

    it('deleteJobPosting delegates to jobPostings.delete and reports success', async () => {
      const { registry, jobPostings } = buildRegistry();
      jobPostings.delete.mockResolvedValue(undefined);

      const outcome = await registry.execute(
        'deleteJobPosting',
        { jobPostingId: 'job-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(jobPostings.delete).toHaveBeenCalledWith('job-1', 'user-1');
      expect(outcome.result).toEqual({ deleted: true, jobPostingId: 'job-1' });
    });

    it('findJobPosting delegates to jobPostings.search and returns a slim result shape', async () => {
      const { registry, jobPostings } = buildRegistry();
      jobPostings.search.mockResolvedValue([
        { id: 'job-1', title: 'Backend Developer', status: 'DRAFT' } as never,
      ]);

      const outcome = await registry.execute(
        'findJobPosting',
        { query: 'Backend' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(jobPostings.search).toHaveBeenCalledWith('Backend');
      expect(outcome.result).toEqual({
        results: [
          { jobPostingId: 'job-1', title: 'Backend Developer', status: 'DRAFT' },
        ],
      });
    });

    it('assignHiringManager resolves the email to a user then assigns them', async () => {
      const { registry, users, jobAssignments } = buildRegistry();
      users.findHiringManagerByEmail.mockResolvedValue({
        id: 'hm-1',
        firstName: 'Pat',
        lastName: 'Manager',
        email: 'pat@example.com',
      });
      jobAssignments.assign.mockResolvedValue({
        id: 'assignment-1',
        jobId: 'job-1',
        hiringManagerUserId: 'hm-1',
        assignedByUserId: 'user-1',
        assignedAt: new Date(),
      });

      const outcome = await registry.execute(
        'assignHiringManager',
        { jobPostingId: 'job-1', hiringManagerEmail: 'pat@example.com' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(users.findHiringManagerByEmail).toHaveBeenCalledWith(
        'pat@example.com',
      );
      expect(jobAssignments.assign).toHaveBeenCalledWith(
        'job-1',
        'hm-1',
        'user-1',
      );
    });

    it('assignHiringManager surfaces a structured error when the email matches no Hiring Manager', async () => {
      const { registry, users, jobAssignments } = buildRegistry();
      users.findHiringManagerByEmail.mockRejectedValue(
        new Error('No active Hiring Manager account found with email "x@example.com".'),
      );

      const outcome = await registry.execute(
        'assignHiringManager',
        { jobPostingId: 'job-1', hiringManagerEmail: 'x@example.com' },
        hrCtx,
      );

      expect(outcome.ok).toBe(false);
      expect(jobAssignments.assign).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('validates args and calls the matching service for matchCandidateToJob', async () => {
      const { registry, matching, audit } = buildRegistry();
      matching.match.mockResolvedValue({
        status: 'READY',
        matchResult: { overallScore: 78 },
      } as never);

      const outcome = await registry.execute(
        'matchCandidateToJob',
        { candidateId: 'cand-1', jobPostingId: 'job-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true);
      expect(matching.match).toHaveBeenCalledWith('cand-1', 'job-1', 'user-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'tool:matchCandidateToJob',
        }),
      );
    });

    it('returns a structured error (not a throw) when required args are missing', async () => {
      const { registry, matching } = buildRegistry();

      const outcome = await registry.execute(
        'matchCandidateToJob',
        { candidateId: 'cand-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(false);
      expect((outcome.result as { error: string }).error).toContain(
        'Invalid arguments',
      );
      expect(matching.match).not.toHaveBeenCalled();
    });

    it('returns a structured error instead of calling uploadCandidateCv when no file is attached', async () => {
      const { registry, cvUpload } = buildRegistry();

      const outcome = await registry.execute(
        'uploadCandidateCv',
        { jobPostingId: 'job-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(true); // the tool itself doesn't throw; it returns a structured "no file" result
      expect((outcome.result as { error: string }).error).toMatch(
        /no cv file/i,
      );
      expect(cvUpload.uploadCv).not.toHaveBeenCalled();
    });

    it('calls uploadCandidateCv with the out-of-band attached file, not from args', async () => {
      const { registry, cvUpload } = buildRegistry();
      cvUpload.uploadCv.mockResolvedValue({
        candidateProfileId: 'cand-1',
        applicationId: 'app-1',
        cvStatus: 'PROCESSING',
      });
      const attachedFile = {
        buffer: Buffer.from('%PDF-1.4'),
        originalname: 'resume.pdf',
      };

      await registry.execute(
        'uploadCandidateCv',
        { jobPostingId: 'job-1' },
        { ...hrCtx, attachedFile },
      );

      expect(cvUpload.uploadCv).toHaveBeenCalledWith(
        'job-1',
        attachedFile,
        'HR_SOURCED',
        'user-1',
      );
    });

    it('never throws even when the underlying service rejects', async () => {
      const { registry, matching } = buildRegistry();
      matching.match.mockRejectedValue(new Error('db unavailable'));

      const outcome = await registry.execute(
        'matchCandidateToJob',
        { candidateId: 'cand-1', jobPostingId: 'job-1' },
        hrCtx,
      );

      expect(outcome.ok).toBe(false);
      expect((outcome.result as { error: string }).error).toBe(
        'db unavailable',
      );
    });
  });

  describe('parseArgs', () => {
    it('returns an empty object for malformed JSON instead of throwing', () => {
      const { registry } = buildRegistry();
      expect(registry.parseArgs('{not valid json')).toEqual({});
    });
  });
});
