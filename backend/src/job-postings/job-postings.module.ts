import { Module } from '@nestjs/common';
import { CvStorageModule } from '../candidates/cv-storage.module';
import { DocumentsModule } from '../documents/documents.module';
import { AudioModule } from '../shared/audio/audio.module';
import { DeadlineSweepService } from './deadline-sweep.service';
import { DraftJobsSweepService } from './draft-jobs-sweep.service';
import { JobPostingAssignmentsController } from './job-posting-assignments.controller';
import { JobPostingAssignmentsService } from './job-posting-assignments.service';
import { JobPostingsController } from './job-postings.controller';
import { JobPostingsService } from './job-postings.service';
import { PublicJobPostingsController } from './public-job-postings.controller';

@Module({
  imports: [DocumentsModule, CvStorageModule, AudioModule],
  controllers: [
    JobPostingsController,
    JobPostingAssignmentsController,
    PublicJobPostingsController,
  ],
  providers: [
    JobPostingsService,
    JobPostingAssignmentsService,
    DraftJobsSweepService,
    DeadlineSweepService,
  ],
  exports: [JobPostingsService, JobPostingAssignmentsService],
})
export class JobPostingsModule {}
