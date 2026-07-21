import { Global, Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';

@Global()
@Module({
  providers: [EmbeddingsService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
