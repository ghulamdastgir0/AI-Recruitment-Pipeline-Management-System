import { AuditLogService } from '../audit/audit-log.service';
import { CvUploadService } from '../candidates/services/cv-upload.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { JobPostingAssignmentsService } from '../job-postings/job-posting-assignments.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { MatchingService } from '../matching/matching.service';
import { RankingService } from '../matching/ranking.service';
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
    audit,
  };
}

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
      ]) {
        expect(registry.isGated(tool, {})).toBe(false);
      }
    });

    it('always gates deleteJobPosting', () => {
      const { registry } = buildRegistry();
      expect(
        registry.isGated('deleteJobPosting', { jobPostingId: 'job-1' }),
      ).toBe(true);
    });
  });

  describe('execute — new job-posting tools', () => {
    it('pauseJobPosting delegates to jobPostings.pause', async () => {
      const { registry, jobPostings } = buildRegistry();
      jobPostings.pause.mockResolvedValue({ id: 'job-1', status: 'PAUSED' } as never);

      const outcome = await registry.execute(
        'pauseJobPosting',
        { jobPostingId: 'job-1' },
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1' },
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
        { actorUserId: 'user-1', attachedFile },
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
        { actorUserId: 'user-1' },
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
