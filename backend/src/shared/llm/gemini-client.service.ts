import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatCompletionResult,
  ChatMessage,
  ToolDefinition,
} from './llm-client.types';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_OPENAI_COMPAT_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

interface GeminiChatCompletionResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
}

/**
 * Gemini client for the recruitment assistant. Talks to Google's
 * OpenAI-compatible chat-completions endpoint rather than the native Gemini
 * REST shape, so it accepts/returns the exact same ChatMessage/ToolDefinition
 * contract as LlmClientService (Groq) — callers don't need to know which
 * provider they're on. Kept as a separate client (not a mode on
 * LlmClientService) so Groq — still used by CV parsing, interviews, matching,
 * and STT/TTS — is untouched by this switch.
 */
@Injectable()
export class GeminiClientService {
  constructor(private readonly config: ConfigService) {}

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      jsonResponse?: boolean;
      model?: string;
    },
  ): Promise<ChatCompletionResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not configured.');
    }

    const response = await fetch(GEMINI_OPENAI_COMPAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:
          options?.model ??
          this.config.get<string>('GEMINI_MODEL') ??
          DEFAULT_MODEL,
        messages,
        // Unlike Groq, Gemini's OpenAI-compat layer strictly rejects any
        // field beyond {type, function} on a tool entry — callers here pass
        // AssistantToolDefinition, which carries extra app-only fields
        // (isGated, requiredRoles), so those have to be stripped before
        // they hit the wire.
        ...(options?.tools
          ? {
              tools: options.tools.map((tool) => ({
                type: tool.type,
                function: tool.function,
              })),
              tool_choice: 'auto',
            }
          : {}),
        ...(options?.jsonResponse
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Gemini API error (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as GeminiChatCompletionResponse;
    const choice = data.choices?.[0];

    return {
      message: choice?.message ?? { role: 'assistant', content: '' },
      finishReason: choice?.finish_reason ?? null,
    };
  }
}
