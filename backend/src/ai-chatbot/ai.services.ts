import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  async ask(query: string): Promise<string> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('GROQ_API_KEY API key is not configured.');
    }

    const apiUrl = this.config.get<string>('GROQ_API_URL');
    if (!apiUrl) {
      throw new InternalServerErrorException('GROQ_API_URL is not configured.');
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get<string>('GROQ_MODEL') ?? DEFAULT_MODEL,
        messages: [{ role: 'user', content: query }],
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
