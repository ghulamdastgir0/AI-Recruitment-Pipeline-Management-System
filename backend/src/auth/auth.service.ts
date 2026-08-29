import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './types';

export interface IssuedToken {
  accessToken: string;
  /** Unix seconds — taken from the token itself so a cookie's lifetime can't drift from it. */
  expiresAt: number;
}

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface LoginResult extends IssuedToken {
  user: UserSummary;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    // Same message as bad credentials — don't leak whether an email exists
    // or is merely deactivated.
    if (!user.isActive) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const issued = await this.issueToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    return {
      ...issued,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  /** Mints a JWT for a user, stamping the current tokenVersion into it. */
  async issueToken(user: {
    id: string;
    email: string;
    role: JwtPayload['role'];
    tokenVersion: number;
  }): Promise<IssuedToken> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = await this.jwt.signAsync(payload);
    // `exp` is read back off the freshly-signed token so the cookie's
    // lifetime can't drift from the token it carries.
    const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
    return { accessToken, expiresAt: exp };
  }

  /**
   * Invalidates every outstanding JWT for a user by moving their
   * tokenVersion forward. Used on password change (revoke everywhere).
   */
  async bumpTokenVersion(userId: string): Promise<number> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return updated.tokenVersion;
  }

  /**
   * Resolves a token to its current user, or null if there's no token / it's
   * expired / forged / revoked. Used by GET /auth/session so the frontend can
   * check "am I logged in?" on load without firing a 401 (which the browser
   * logs as a console error on every anonymous page view).
   */
  async sessionFromToken(
    token: string | undefined,
  ): Promise<UserSummary | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
        return null;
      }
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      };
    } catch {
      return null;
    }
  }

  /**
   * Best-effort logout: if the presented token is valid, bump that user's
   * tokenVersion so the token (and any sibling session) stops working
   * server-side, not just in the current browser. Never throws — logout
   * must always "succeed" from the caller's point of view.
   */
  async revokeSessionForToken(token: string | undefined): Promise<void> {
    if (!token) return;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      await this.bumpTokenVersion(payload.sub);
    } catch {
      // Expired / forged / already-revoked — nothing to do.
    }
  }
}
