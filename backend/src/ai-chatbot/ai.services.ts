import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentRetrievalService,
  RetrievedChunk,
} from '../documents/services/document-retrieval.service';
import { HR_ASSISTANT_SYSTEM_PROMPT } from './system-prompt';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
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
    private readonly config: ConfigService,
    private readonly documentRetrieval: DocumentRetrievalService,
  ) {}

  async ask(query: string): Promise<AskResult> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('GROQ_API_KEY is not configured.');
    }

    const apiUrl = this.config.get<string>('GROQ_API_URL');
    if (!apiUrl) {
      throw new InternalServerErrorException('GROQ_API_URL is not configured.');
    }

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

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get<string>('GROQ_MODEL') ?? DEFAULT_MODEL,
        messages: [
          { role: 'system', content: HR_ASSISTANT_SYSTEM_PROMPT },
          {
            role: 'system',
            content: `Relevant company policy excerpts, retrieved via pgvector similarity search over active documents, most relevant first:\n\n${context}`,
          },
          { role: 'user', content: query },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Groq API error (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return {
      answer: data.choices?.[0]?.message?.content ?? '',
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
