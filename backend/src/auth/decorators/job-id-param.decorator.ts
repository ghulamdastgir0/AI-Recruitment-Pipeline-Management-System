import { SetMetadata } from '@nestjs/common';

export const JOB_ID_PARAM_KEY = 'jobIdParam';

/** Names the route param JobAssignmentGuard should read as the job posting id. Defaults to "jobPostingId" when absent. */
export const JobIdParam = (paramName: string) =>
  SetMetadata(JOB_ID_PARAM_KEY, paramName);
