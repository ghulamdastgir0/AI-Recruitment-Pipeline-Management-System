import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { RankingService } from './ranking.service';

@Module({
  providers: [MatchingService, RankingService],
  exports: [MatchingService, RankingService],
})
export class MatchingModule {}
