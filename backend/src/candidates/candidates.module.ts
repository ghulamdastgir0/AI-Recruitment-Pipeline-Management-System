import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { MatchingModule } from '../matching/matching.module';
import { CandidatesController } from './candidates.controller';
import { CvStorageModule } from './cv-storage.module';
import { CvParserService } from './services/cv-parser.service';
import { CvProcessorService } from './services/cv-processor.service';
import { CvUploadService } from './services/cv-upload.service';

@Module({
  imports: [
    // Local (not global) — CV upload is the only endpoint reachable without
    // auth, so rate-limiting stays scoped here instead of applying a
    // default limit to every authenticated/staff endpoint too.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    MatchingModule,
    CvStorageModule,
  ],
  controllers: [CandidatesController],
  providers: [CvParserService, CvProcessorService, CvUploadService],
  exports: [CvUploadService],
})
export class CandidatesModule {}
