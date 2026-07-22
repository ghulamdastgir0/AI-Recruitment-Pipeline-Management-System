import { ConfigService } from '@nestjs/config';
import { GroqAudioService } from './groq-audio.service';

const CONFIG_VALUES: Record<string, string> = {
  GROQ_API_KEY: 'test-groq-key',
  GROQ_STT_API_URL: 'https://api.groq.com/openai/v1/audio/transcriptions',
  GROQ_STT_MODEL: 'whisper-large-v3-turbo',
  GROQ_TTS_API_URL: 'https://api.groq.com/openai/v1/audio/speech',
  GROQ_TTS_MODEL: 'playai-tts',
  GROQ_TTS_VOICE: 'Fritz-PlayAI',
};

function buildService(overrides: Partial<Record<string, string>> = {}) {
  const values = { ...CONFIG_VALUES, ...overrides };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as jest.Mocked<ConfigService>;
  return { service: new GroqAudioService(config) };
}

describe('GroqAudioService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('transcribe', () => {
    it('POSTs multipart form data with the bearer token and returns the trimmed text', async () => {
      const { service } = buildService();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '  hello world  ' }),
      });
      global.fetch = fetchMock;

      const text = await service.transcribe(
        Buffer.from('audio bytes'),
        'answer.wav',
      );

      expect(text).toBe('hello world');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(CONFIG_VALUES.GROQ_STT_API_URL);
      expect(options.headers).toMatchObject({
        Authorization: 'Bearer test-groq-key',
      });
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('throws when Groq responds with a non-ok status', async () => {
      const { service } = buildService();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('bad audio'),
      });

      await expect(
        service.transcribe(Buffer.from('audio bytes'), 'answer.wav'),
      ).rejects.toThrow(/Groq STT error \(400\)/);
    });

    it('throws when GROQ_API_KEY is not configured', async () => {
      const { service } = buildService({ GROQ_API_KEY: undefined });
      global.fetch = jest.fn();

      await expect(
        service.transcribe(Buffer.from('audio bytes'), 'answer.wav'),
      ).rejects.toThrow(/GROQ_API_KEY is not configured/);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('synthesizeSpeech', () => {
    it('POSTs JSON with model/voice/input and returns the raw audio buffer', async () => {
      const { service } = buildService();
      const audioBytes = new Uint8Array([1, 2, 3, 4]).buffer;
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBytes),
      });
      global.fetch = fetchMock;

      const buffer = await service.synthesizeSpeech('What is a closure?');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(Array.from(buffer)).toEqual([1, 2, 3, 4]);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(CONFIG_VALUES.GROQ_TTS_API_URL);
      const body = JSON.parse(options.body as string) as {
        model: string;
        voice: string;
        input: string;
        response_format: string;
      };
      expect(body).toEqual({
        model: 'playai-tts',
        voice: 'Fritz-PlayAI',
        input: 'What is a closure?',
        response_format: 'wav',
      });
    });

    it('throws when Groq responds with a non-ok status', async () => {
      const { service } = buildService();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('tts down'),
      });

      await expect(service.synthesizeSpeech('hi')).rejects.toThrow(
        /Groq TTS error \(500\)/,
      );
    });
  });
});
