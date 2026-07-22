import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { MatchingModule } from '../matching/matching.module';
import { CandidatesController } from './candidates.controller';
import { CvParserService } from './services/cv-parser.service';
import { CvProcessorService } from './services/cv-processor.service';
import { CvStorageService } from './services/cv-storage.service';
import { CvUploadService } from './services/cv-upload.service';

@Module({
  imports: [
    // Local (not global) — CV upload is the only endpoint reachable without
    // auth, so rate-limiting stays scoped here instead of applying a
    // default limit to every authenticated/staff endpoint too.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    MatchingModule,
  ],
  controllers: [CandidatesController],
  providers: [
    CvParserService,
    CvProcessorService,
    CvStorageService,
    CvUploadService,
  ],
  exports: [CvUploadService],
})
export class CandidatesModule {}
