import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeBaseService } from './knowledge-base.service';
import { HR_ASSISTANT_SYSTEM_PROMPT } from './system-prompt';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

@Injectable()
export class AiService {
  constructor(
    private readonly config: ConfigService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  async ask(query: string): Promise<string> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('GROQ_API_KEY is not configured.');
    }

    const apiUrl = this.config.get<string>('GROQ_API_URL');
    if (!apiUrl) {
      throw new InternalServerErrorException('GROQ_API_URL is not configured.');
    }

    const retrievedChunks = await this.knowledgeBase.retrieve(query);
    const context =
      retrievedChunks.length > 0
        ? retrievedChunks.map((chunk) => `[${chunk.title}]\n${chunk.content}`).join('\n\n---\n\n')
        : '(No relevant company documents were retrieved for this query.)';

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
            content: `Relevant company knowledge base excerpts, retrieved via pgvector similarity search, most relevant first:\n\n${context}`,
          },
          { role: 'user', content: query },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Groq API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return data.choices?.[0]?.message?.content ?? '';
  }
}
