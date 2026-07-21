import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AiController } from './ai.controllers';
import { AiService } from './ai.services';

@Module({
  imports: [DocumentsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
