import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatCompletionResult,
  ChatMessage,
  ToolDefinition,
} from './llm-client.types';

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

interface GroqChatCompletionResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
}

/**
 * Single Groq (OpenAI-compatible chat completions) client shared by every
 * LLM-facing feature — the policy chatbot and the tool-calling recruitment
 * assistant both depend on this instead of each doing their own fetch.
 */
@Injectable()
export class LlmClientService {
  constructor(private readonly config: ConfigService) {}

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      jsonResponse?: boolean;
      /** Overrides GROQ_MODEL/DEFAULT_MODEL for this call — some tasks need a different model than the shared default. */
      model?: string;
    },
  ): Promise<ChatCompletionResult> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('GROQ_API_KEY is not configured.');
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
        model:
          options?.model ??
          this.config.get<string>('GROQ_MODEL') ??
          DEFAULT_MODEL,
        messages,
        ...(options?.tools
          ? { tools: options.tools, tool_choice: 'auto' }
          : {}),
        ...(options?.jsonResponse
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Groq API error (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as GroqChatCompletionResponse;
    const choice = data.choices?.[0];

    return {
      message: choice?.message ?? { role: 'assistant', content: '' },
      finishReason: choice?.finish_reason ?? null,
    };
  }
}
