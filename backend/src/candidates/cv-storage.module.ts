import { Module } from '@nestjs/common';
import { CvStorageService } from './services/cv-storage.service';

/**
 * CvStorageService as its own leaf module — both CandidatesModule (CV
 * upload) and MatchingModule (CV download endpoint) need it, and
 * CandidatesModule already imports MatchingModule, so MatchingModule
 * importing CandidatesModule back would be circular. Both import this
 * instead, neither imports the other for this.
 */
@Module({
  providers: [CvStorageService],
  exports: [CvStorageService],
})
export class CvStorageModule {}
