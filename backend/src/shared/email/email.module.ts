import { Global, Module } from '@nestjs/common';
import { CandidateLinksService } from '../links/candidate-links.service';
import { EmailService } from './email.service';

@Global()
@Module({
  providers: [EmailService, CandidateLinksService],
  exports: [EmailService, CandidateLinksService],
})
export class EmailModule {}
