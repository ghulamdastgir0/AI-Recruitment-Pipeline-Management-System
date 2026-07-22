import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const CONFIG_VALUES: Record<string, string> = {
  SMTP_API: 'test-brevo-key',
  BREVO_SENDER_EMAIL: 'sender@example.com',
  BREVO_SENDER_NAME: 'Test Sender',
};

function buildService(overrides: Partial<Record<string, string>> = {}) {
  const values = { ...CONFIG_VALUES, ...overrides };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as jest.Mocked<ConfigService>;
  return { service: new EmailService(config) };
}

describe('EmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('skips sending and returns false when there is no recipient email', async () => {
    const { service } = buildService();
    global.fetch = jest.fn();

    const sent = await service.send({
      to: null,
      type: 'SCREENING_REJECTION',
      variables: { jobTitle: 'Backend Engineer' },
    });

    expect(sent).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips sending and returns false when Brevo is not configured', async () => {
    const { service } = buildService({
      SMTP_API: undefined,
      BREVO_SENDER_EMAIL: undefined,
    });
    global.fetch = jest.fn();

    const sent = await service.send({
      to: 'candidate@example.com',
      type: 'SCREENING_REJECTION',
      variables: { jobTitle: 'Backend Engineer' },
    });

    expect(sent).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to Brevo with the api-key header and templated content, returning true on success', async () => {
    const { service } = buildService();
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    global.fetch = fetchMock;

    const sent = await service.send({
      to: 'candidate@example.com',
      type: 'SCREENING_REJECTION',
      variables: { candidateName: 'Jane', jobTitle: 'Backend Engineer' },
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers).toMatchObject({ 'api-key': 'test-brevo-key' });
    const body = JSON.parse(options.body as string) as {
      to: { email: string }[];
      subject: string;
      htmlContent: string;
    };
    expect(body.to).toEqual([{ email: 'candidate@example.com' }]);
    expect(body.htmlContent).toContain('Jane');
    expect(body.htmlContent).toContain('Backend Engineer');
  });

  it('returns false when Brevo responds with a non-ok status', async () => {
    const { service } = buildService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad request'),
    });

    const sent = await service.send({
      to: 'candidate@example.com',
      type: 'SELECTION',
      variables: { jobTitle: 'Backend Engineer' },
    });

    expect(sent).toBe(false);
  });

  it('returns false instead of throwing when fetch itself rejects', async () => {
    const { service } = buildService();
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const sent = await service.send({
      to: 'candidate@example.com',
      type: 'REJECTION',
      variables: { jobTitle: 'Backend Engineer' },
    });

    expect(sent).toBe(false);
  });
});
