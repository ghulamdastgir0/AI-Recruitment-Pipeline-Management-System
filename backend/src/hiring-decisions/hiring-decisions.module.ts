import { Module } from '@nestjs/common';
import { CandidateCommentsModule } from '../candidate-comments/candidate-comments.module';
import { JobPostingsModule } from '../job-postings/job-postings.module';
import { HiringDecisionsController } from './hiring-decisions.controller';
import { HiringDecisionsService } from './hiring-decisions.service';

@Module({
  imports: [JobPostingsModule, CandidateCommentsModule],
  controllers: [HiringDecisionsController],
  providers: [HiringDecisionsService],
  exports: [HiringDecisionsService],
})
export class HiringDecisionsModule {}
