import { AuditLogService } from '../audit/audit-log.service';
import { CvUploadService } from '../candidates/services/cv-upload.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { MatchingService } from '../matching/matching.service';
import { RankingService } from '../matching/ranking.service';
import { ToolRegistryService } from './tool-registry.service';

function buildRegistry() {
  const documentRetrieval = {
    retrieve: jest.fn(),
  } as unknown as jest.Mocked<DocumentRetrievalService>;
  const jobPostings = {
    create: jest.fn(),
    update: jest.fn(),
    publish: jest.fn(),
  } as unknown as jest.Mocked<JobPostingsService>;
  const cvUpload = {
    uploadCv: jest.fn(),
    getStatus: jest.fn(),
  } as unknown as jest.Mocked<CvUploadService>;
  const matching = {
    match: jest.fn(),
    getLatestExplanation: jest.fn(),
  } as unknown as jest.Mocked<MatchingService>;
  const ranking = { rank: jest.fn() } as unknown as jest.Mocked<RankingService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;

  const registry = new ToolRegistryService(
    documentRetrieval,
    jobPostings,
    cvUpload,
    matching,
    ranking,
    audit,
  );
  return {
    registry,
    documentRetrieval,
    jobPostings,
    cvUpload,
    matching,
    ranking,
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
      ]) {
        expect(registry.isGated(tool, {})).toBe(false);
      }
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
