import { Injectable, Logger } from '@nestjs/common';
import {
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      this.logger.log(
        `Loading local embedding model: ${MODEL_ID} (first call downloads and caches it)`,
      );
      this.extractorPromise = pipeline('feature-extraction', MODEL_ID);
    }
    return this.extractorPromise;
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  /** Formats an embedding vector as a pgvector literal for raw SQL queries, e.g. `[0.1,0.2,...]`. */
  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
