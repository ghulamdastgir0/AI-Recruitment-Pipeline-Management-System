import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { JobPostingAssignmentsController } from './job-posting-assignments.controller';
import { JobPostingAssignmentsService } from './job-posting-assignments.service';
import { JobPostingsController } from './job-postings.controller';
import { JobPostingsService } from './job-postings.service';
import { PublicJobPostingsController } from './public-job-postings.controller';

@Module({
  imports: [DocumentsModule],
  controllers: [
    JobPostingsController,
    JobPostingAssignmentsController,
    PublicJobPostingsController,
  ],
  providers: [JobPostingsService, JobPostingAssignmentsService],
  exports: [JobPostingsService, JobPostingAssignmentsService],
})
export class JobPostingsModule {}
