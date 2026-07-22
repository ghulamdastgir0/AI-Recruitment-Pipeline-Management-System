import { Module } from '@nestjs/common';
import { HiringDecisionsController } from './hiring-decisions.controller';
import { HiringDecisionsService } from './hiring-decisions.service';

@Module({
  controllers: [HiringDecisionsController],
  providers: [HiringDecisionsService],
})
export class HiringDecisionsModule {}
