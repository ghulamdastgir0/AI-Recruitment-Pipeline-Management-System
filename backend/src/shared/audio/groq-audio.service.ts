import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GroqTranscriptionResponse {
  text?: string;
}

/**
 * Groq's speech endpoints (Whisper transcription + PlayAI text-to-speech),
 * used to turn candidate audio answers into text and interview questions
 * into spoken audio. Separate from LlmClientService since these are
 * different endpoints/payload shapes (multipart in, raw binary out) sharing
 * only the same GROQ_API_KEY.
 */
@Injectable()
export class GroqAudioService {
  constructor(private readonly config: ConfigService) {}

  async transcribe(buffer: Buffer, filename: string): Promise<string> {
    const apiKey = this.requireConfig('GROQ_API_KEY');
    const apiUrl = this.requireConfig('GROQ_STT_API_URL');
    const model =
      this.config.get<string>('GROQ_STT_MODEL') ?? 'whisper-large-v3-turbo';

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);
    form.append('model', model);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Groq STT error (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as GroqTranscriptionResponse;
    return (data.text ?? '').trim();
  }

  async synthesizeSpeech(text: string): Promise<Buffer> {
    const apiKey = this.requireConfig('GROQ_API_KEY');
    const apiUrl = this.requireConfig('GROQ_TTS_API_URL');
    const model = this.config.get<string>('GROQ_TTS_MODEL') ?? 'playai-tts';
    const voice = this.config.get<string>('GROQ_TTS_VOICE') ?? 'Fritz-PlayAI';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'wav',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Groq TTS error (${response.status}): ${errorBody}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private requireConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(`${key} is not configured.`);
    }
    return value;
  }
}
