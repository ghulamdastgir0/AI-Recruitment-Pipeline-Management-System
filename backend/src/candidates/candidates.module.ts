import { Module } from '@nestjs/common';
import { CandidatesController } from './candidates.controller';
import { CvParserService } from './services/cv-parser.service';
import { CvProcessorService } from './services/cv-processor.service';
import { CvStorageService } from './services/cv-storage.service';
import { CvUploadService } from './services/cv-upload.service';

@Module({
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
