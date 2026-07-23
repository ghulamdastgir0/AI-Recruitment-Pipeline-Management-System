import { ConfigService } from '@nestjs/config';
import { LlmClientService } from '../../shared/llm/llm-client.service';
import { CvParserService } from './cv-parser.service';

const VALID_JSON = JSON.stringify({
  name: 'Jane Candidate',
  email: 'jane@example.com',
  phone: null,
  skills: ['TypeScript', 'NestJS'],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  experienceYears: 3,
});

function buildService() {
  const llm = {
    chat: jest.fn(),
  } as unknown as jest.Mocked<LlmClientService>;
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as jest.Mocked<ConfigService>;
  return { service: new CvParserService(llm, config), llm };
}

describe('CvParserService', () => {
  it('succeeds on the first attempt when the model returns valid JSON', async () => {
    const { service, llm } = buildService();
    llm.chat.mockResolvedValue({
      message: { role: 'assistant', content: VALID_JSON },
      finishReason: 'stop',
    });

    const result = await service.parse('some resume text');

    expect(result.skills).toEqual(['TypeScript', 'NestJS']);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('retries when the LLM call itself throws (e.g. Groq json_validate_failed on malformed output), instead of failing immediately', async () => {
    const { service, llm } = buildService();
    llm.chat
      .mockRejectedValueOnce(
        new Error(
          'Groq API error (400): {"error":{"code":"json_validate_failed"}}',
        ),
      )
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: VALID_JSON },
        finishReason: 'stop',
      });

    const result = await service.parse('some resume text');

    expect(result.skills).toEqual(['TypeScript', 'NestJS']);
    expect(llm.chat).toHaveBeenCalledTimes(2);
    // The retry prompt should carry a short correction forward, not echo
    // the provider's raw error (which embeds the model's own bad, CV-shaped
    // output and would just cue it to keep "correcting" CV text).
    const secondCallMessages = llm.chat.mock.calls[1][0];
    const userMessage = secondCallMessages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('not a valid JSON object');
    expect(userMessage?.content).not.toContain('json_validate_failed');
  });

  it('collapses a Groq json_validate_failed error to a short correction instead of echoing the raw failed_generation blob', async () => {
    const { service, llm } = buildService();
    const hugeFailedGeneration = 'CV-shaped garbled text '.repeat(200);
    llm.chat
      .mockRejectedValueOnce(
        new Error(
          `Groq API error (400): {"error":{"code":"json_validate_failed","failed_generation":"${hugeFailedGeneration}"}}`,
        ),
      )
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: VALID_JSON },
        finishReason: 'stop',
      });

    await service.parse('some resume text');

    const secondCallMessages = llm.chat.mock.calls[1][0];
    const userMessage = secondCallMessages.find((m) => m.role === 'user');
    expect(userMessage?.content).not.toContain('CV-shaped garbled text');
  });

  it('retries when the returned content is not valid JSON', async () => {
    const { service, llm } = buildService();
    llm.chat
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'not json at all' },
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: VALID_JSON },
        finishReason: 'stop',
      });

    const result = await service.parse('some resume text');

    expect(result.skills).toEqual(['TypeScript', 'NestJS']);
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts if every attempt fails', async () => {
    const { service, llm } = buildService();
    llm.chat.mockRejectedValue(new Error('Groq API error (400): boom'));

    await expect(service.parse('some resume text')).rejects.toThrow(
      /CV parsing produced invalid structured data after 3 attempts/,
    );
    expect(llm.chat).toHaveBeenCalledTimes(3);
  });

  it('strips protected characteristics even when the model includes them', async () => {
    const { service, llm } = buildService();
    llm.chat.mockResolvedValue({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          name: 'Jane Candidate',
          age: 29,
          gender: 'female',
          skills: ['TypeScript'],
          experience: [],
          projects: [],
          education: [],
          certifications: [],
          experienceYears: 3,
        }),
      },
      finishReason: 'stop',
    });

    const result = await service.parse('some resume text');

    expect(result).not.toHaveProperty('age');
    expect(result).not.toHaveProperty('gender');
  });
});
