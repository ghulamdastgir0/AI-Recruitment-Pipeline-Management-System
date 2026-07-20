import { Module } from '@nestjs/common';
import { AiController } from './ai.controllers';
import { AiService } from './ai.services';

@Module({
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
