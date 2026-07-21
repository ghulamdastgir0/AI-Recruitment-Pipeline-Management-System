import { Injectable } from '@nestjs/common';
import {
  DocumentRetrievalService,
  RetrievedChunk,
} from '../documents/services/document-retrieval.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { HR_ASSISTANT_SYSTEM_PROMPT } from './system-prompt';

// Chunks below this cosine similarity are treated as "not actually relevant"
// so an off-topic question doesn't drag in the nearest (but irrelevant)
// policy chunks as if they were grounding context or citations.
const MIN_RELEVANT_SIMILARITY = 0.35;

export interface Citation {
  documentId: string;
  documentName: string;
  version: number;
  pageNumber: number;
  citation: string;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
}

@Injectable()
export class AiService {
  constructor(
    private readonly llm: LlmClientService,
    private readonly documentRetrieval: DocumentRetrievalService,
  ) {}

  async ask(query: string): Promise<AskResult> {
    const retrievedChunks = await this.documentRetrieval.retrieve(query);
    const relevantChunks = retrievedChunks.filter(
      (chunk) => chunk.similarity >= MIN_RELEVANT_SIMILARITY,
    );

    const context =
      relevantChunks.length > 0
        ? relevantChunks
            .map(
              (chunk) => `[Source: ${formatCitation(chunk)}]\n${chunk.content}`,
            )
            .join('\n\n---\n\n')
        : '(No relevant company policy documents were retrieved for this query.)';

    const result = await this.llm.chat([
      { role: 'system', content: HR_ASSISTANT_SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Relevant company policy excerpts, retrieved via pgvector similarity search over active documents, most relevant first:\n\n${context}`,
      },
      { role: 'user', content: query },
    ]);

    return {
      answer: result.message.content ?? '',
      citations: dedupeCitations(relevantChunks),
    };
  }
}

function formatCitation(chunk: RetrievedChunk): string {
  return `${chunk.documentName}, version ${chunk.version}, page ${chunk.pageNumber}`;
}

function dedupeCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const chunk of chunks) {
    const citation = formatCitation(chunk);
    if (!seen.has(citation)) {
      seen.set(citation, {
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        version: chunk.version,
        pageNumber: chunk.pageNumber,
        citation,
      });
    }
  }
  return Array.from(seen.values());
}
