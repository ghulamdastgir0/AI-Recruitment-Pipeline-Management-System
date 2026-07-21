import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const ADMIN_API_KEY_HEADER = 'x-admin-api-key';

/**
 * Stand-in admin authorization for the document-management endpoints.
 * This project has no JWT/user-session auth yet (Role.ADMIN exists on the
 * User model but nothing issues or verifies tokens), so this guard checks a
 * shared secret header against ADMIN_API_KEY instead. It's isolated behind
 * this single Guard so swapping in real JWT + RBAC later only means
 * replacing this class, not the controllers that depend on it.
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.config.get<string>('ADMIN_API_KEY');
    if (!expectedKey) {
      throw new InternalServerErrorException(
        'ADMIN_API_KEY is not configured on the server.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.header(ADMIN_API_KEY_HEADER);

    if (!providedKey || !this.matches(providedKey, expectedKey)) {
      throw new UnauthorizedException('A valid admin API key is required.');
    }

    return true;
  }

  private matches(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
