import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE, JwtPayload } from '../types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // The httpOnly cookie is the real session for the frontend (immune to
    // XSS token theft, unlike the old localStorage token); the Authorization
    // header stays supported as a fallback for the Swagger "Authorize"
    // button and any non-browser API client.
    const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE] as
      | string
      | undefined;
    const authHeader = request.header('authorization');
    const headerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedException('A valid bearer token is required.');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      // JWTs are stateless and live up to JWT_EXPIRES_IN (8h) — re-check the
      // user still exists and is active on every request, so deactivating
      // someone takes effect immediately instead of waiting out their token.
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid or expired token.');
      }
      // Session revocation: logout and password change bump the row's
      // tokenVersion. A token minted before that no longer matches and is
      // dead server-side, even though it hasn't expired.
      if (payload.tokenVersion !== user.tokenVersion) {
        throw new UnauthorizedException('Invalid or expired token.');
      }
      request.user = {
        id: user.id,
        email: user.email,
        role: user.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}
