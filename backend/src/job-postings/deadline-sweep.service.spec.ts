import { JobPostingsService } from './job-postings.service';
import { DeadlineSweepService } from './deadline-sweep.service';

function buildService(closedCount: number) {
  const jobPostings = {
    closeExpiredPublishedJobs: jest.fn().mockResolvedValue(closedCount),
  } as unknown as jest.Mocked<JobPostingsService>;

  return { service: new DeadlineSweepService(jobPostings), jobPostings };
}

describe('DeadlineSweepService', () => {
  it('delegates to JobPostingsService.closeExpiredPublishedJobs', async () => {
    const { service, jobPostings } = buildService(3);

    await service.closeExpiredJobs();

    expect(jobPostings.closeExpiredPublishedJobs).toHaveBeenCalledTimes(1);
  });

  it('does not throw when nothing is due', async () => {
    const { service } = buildService(0);
    await expect(service.closeExpiredJobs()).resolves.toBeUndefined();
  });
});
