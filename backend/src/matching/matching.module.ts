import { Module } from '@nestjs/common';
import { CvStorageModule } from '../candidates/cv-storage.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { RankingService } from './ranking.service';

@Module({
  imports: [CvStorageModule],
  controllers: [MatchingController],
  providers: [MatchingService, RankingService],
  exports: [MatchingService, RankingService],
})
export class MatchingModule {}
