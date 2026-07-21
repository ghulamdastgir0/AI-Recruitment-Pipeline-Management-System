import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { RankingService } from './ranking.service';

@Module({
  controllers: [MatchingController],
  providers: [MatchingService, RankingService],
  exports: [MatchingService, RankingService],
})
export class MatchingModule {}
