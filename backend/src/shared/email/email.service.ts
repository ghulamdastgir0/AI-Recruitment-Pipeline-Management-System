import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailType } from '../../generated/prisma/enums';
import { buildEmail, EmailVariables } from './email-templates';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

export interface SendEmailInput {
  to: string | null | undefined;
  type: EmailType;
  variables: EmailVariables;
}

/**
 * Sends candidate-facing transactional email via Brevo's HTTP API (the
 * SMTP_API key already in .env is a Brevo API key, not SMTP credentials).
 * Callers decide whether to write an EmailLog row based on the returned
 * boolean — nothing should be logged as "sent" if it wasn't.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async send(input: SendEmailInput): Promise<boolean> {
    if (!input.to) {
      this.logger.warn(
        `Skipping ${input.type} email — no candidate email on file.`,
      );
      return false;
    }

    const apiKey = this.config.get<string>('SMTP_API');
    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL');
    const senderName = this.config.get<string>('BREVO_SENDER_NAME');
    if (!apiKey || !senderEmail) {
      this.logger.warn(
        `Skipping ${input.type} email — Brevo is not configured (SMTP_API/BREVO_SENDER_EMAIL missing).`,
      );
      return false;
    }

    const { subject, html } = buildEmail(input.type, input.variables);

    try {
      const response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName || undefined },
          to: [{ email: input.to }],
          subject,
          htmlContent: html,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Brevo send failed for ${input.type} to ${input.to}: (${response.status}) ${errorBody}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Brevo send threw for ${input.type} to ${input.to}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return false;
    }
  }
}
