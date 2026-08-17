import { Injectable, Logger } from '@nestjs/common';
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Default cache dir is inside node_modules/@huggingface/transformers/.cache —
// fine when the process owns its own node_modules, but the backend container
// runs as the unprivileged `node` user (see backend/Dockerfile), which only
// has write access to /tmp there. Without this, the *first* embed() call in
// any fresh container ever throws EACCES trying to download/cache the model
// — which silently takes down every embedding-touching path (job create/edit,
// CV scoring, document RAG) with a generic 500, since embed() is awaited
// inline rather than treated as a possibly-failing external call.
env.cacheDir = '/tmp/transformers-cache';

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

  /** Parses a pgvector column selected via `::text` (e.g. `[0.1,0.2,...]`) back into a plain number array. */
  parseVectorLiteral(text: string | null | undefined): number[] | null {
    if (!text) return null;
    return JSON.parse(text) as number[];
  }
}
