import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_PUBLIC_APP_URL = 'http://localhost:3001';

/** Builds candidate-facing frontend URLs (interview page, etc.) for use in emails. */
@Injectable()
export class CandidateLinksService {
  constructor(private readonly config: ConfigService) {}

  interviewUrl(applicationId: string): string {
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ?? DEFAULT_PUBLIC_APP_URL;
    return `${base.replace(/\/$/, '')}/interview/${applicationId}`;
  }

  statusUrl(applicationId: string): string {
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ?? DEFAULT_PUBLIC_APP_URL;
    return `${base.replace(/\/$/, '')}/status/${applicationId}`;
  }
}
