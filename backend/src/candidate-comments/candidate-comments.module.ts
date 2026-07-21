import { Module } from '@nestjs/common';
import { CandidateCommentsController } from './candidate-comments.controller';
import { CandidateCommentsService } from './candidate-comments.service';

@Module({
  controllers: [CandidateCommentsController],
  providers: [CandidateCommentsService],
  exports: [CandidateCommentsService],
})
export class CandidateCommentsModule {}
