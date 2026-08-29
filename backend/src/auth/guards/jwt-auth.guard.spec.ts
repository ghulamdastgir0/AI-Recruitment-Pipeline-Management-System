import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../types';
import { JwtAuthGuard } from './jwt-auth.guard';

function contextWith(token?: string): ExecutionContext {
  const req = {
    cookies: token ? { [ACCESS_TOKEN_COOKIE]: token } : {},
    header: () => undefined,
  } as unknown;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function build(
  payload: Record<string, unknown> | null,
  userRow: Record<string, unknown> | null,
) {
  const jwt = {
    verifyAsync: payload
      ? jest.fn().mockResolvedValue(payload)
      : jest.fn().mockRejectedValue(new Error('bad')),
  } as unknown as JwtService;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(userRow) },
  } as unknown as PrismaService;
  return { guard: new JwtAuthGuard(jwt, prisma), prisma };
}

const activeUser = {
  id: 'u1',
  email: 'a@b.com',
  role: 'HR_ADMIN',
  isActive: true,
  tokenVersion: 2,
};

describe('JwtAuthGuard', () => {
  it('allows a valid token whose tokenVersion matches the row', async () => {
    const { guard } = build(
      { sub: 'u1', email: 'a@b.com', role: 'HR_ADMIN', tokenVersion: 2 },
      activeUser,
    );
    await expect(guard.canActivate(contextWith('t'))).resolves.toBe(true);
  });

  it('rejects when no token is present', async () => {
    const { guard } = build(null, null);
    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token whose tokenVersion is behind the row (revoked session)', async () => {
    const { guard } = build(
      { sub: 'u1', email: 'a@b.com', role: 'HR_ADMIN', tokenVersion: 1 },
      activeUser, // row is now at tokenVersion 2
    );
    await expect(guard.canActivate(contextWith('t'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the user has been deactivated', async () => {
    const { guard } = build(
      { sub: 'u1', email: 'a@b.com', role: 'HR_ADMIN', tokenVersion: 2 },
      { ...activeUser, isActive: false },
    );
    await expect(guard.canActivate(contextWith('t'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the user no longer exists', async () => {
    const { guard } = build(
      { sub: 'u1', email: 'a@b.com', role: 'HR_ADMIN', tokenVersion: 2 },
      null,
    );
    await expect(guard.canActivate(contextWith('t'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
