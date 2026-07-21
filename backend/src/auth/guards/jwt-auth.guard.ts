import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.header('authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

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
