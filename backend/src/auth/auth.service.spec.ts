import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const user = {
    id: 'user-1',
    email: 'hr@example.com',
    passwordHash: bcrypt.hashSync('correct-password', 4),
    firstName: 'HR',
    lastName: 'Admin',
    role: 'SUPER_ADMIN' as const,
    isActive: true,
    tokenVersion: 3,
  };

  function buildService() {
    const prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      // issueToken reads `exp` back off the freshly-signed token.
      decode: jest.fn().mockReturnValue({ exp: 1_800_000_000 }),
    } as unknown as jest.Mocked<JwtService>;
    return { service: new AuthService(prisma, jwt), prisma, jwt };
  }

  it('returns an access token and user summary for correct credentials', async () => {
    const { service, prisma, jwt } = buildService();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

    const result = await service.login('hr@example.com', 'correct-password');

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'hr@example.com',
      firstName: 'HR',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'hr@example.com',
      role: 'SUPER_ADMIN',
      tokenVersion: 3,
    });
  });

  it('bumpTokenVersion increments the row and returns the new value', async () => {
    const { service, prisma } = buildService();
    (prisma.user.update as jest.Mock).mockResolvedValue({ tokenVersion: 4 });

    const next = await service.bumpTokenVersion('user-1');

    expect(next).toBe(4);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      }),
    );
  });

  it('revokeSessionForToken is a no-op for a missing/invalid token', async () => {
    const { service, prisma, jwt } = buildService();
    (jwt as unknown as { verifyAsync: jest.Mock }).verifyAsync = jest
      .fn()
      .mockRejectedValue(new Error('bad token'));

    await expect(
      service.revokeSessionForToken(undefined),
    ).resolves.toBeUndefined();
    await expect(
      service.revokeSessionForToken('garbage'),
    ).resolves.toBeUndefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  describe('sessionFromToken', () => {
    it('returns null when there is no token', async () => {
      const { service } = buildService();
      await expect(service.sessionFromToken(undefined)).resolves.toBeNull();
    });

    it('returns null for a forged/expired token', async () => {
      const { service, jwt } = buildService();
      (jwt as unknown as { verifyAsync: jest.Mock }).verifyAsync = jest
        .fn()
        .mockRejectedValue(new Error('bad'));
      await expect(service.sessionFromToken('nope')).resolves.toBeNull();
    });

    it('returns null when the token tokenVersion is behind the row (revoked)', async () => {
      const { service, prisma, jwt } = buildService();
      (jwt as unknown as { verifyAsync: jest.Mock }).verifyAsync = jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', tokenVersion: 2 });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user); // row at 3

      await expect(service.sessionFromToken('t')).resolves.toBeNull();
    });

    it('returns the user summary for a current token', async () => {
      const { service, prisma, jwt } = buildService();
      (jwt as unknown as { verifyAsync: jest.Mock }).verifyAsync = jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', tokenVersion: 3 });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

      await expect(service.sessionFromToken('t')).resolves.toEqual({
        id: 'user-1',
        email: 'hr@example.com',
        firstName: 'HR',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
      });
    });
  });

  it('rejects an unknown email', async () => {
    const { service, prisma } = buildService();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.login('nobody@example.com', 'whatever'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an incorrect password without revealing which part was wrong', async () => {
    const { service, prisma } = buildService();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

    await expect(
      service.login('hr@example.com', 'wrong-password'),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('rejects a deactivated user with the same message as bad credentials', async () => {
    const { service, prisma } = buildService();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...user,
      isActive: false,
    });

    await expect(
      service.login('hr@example.com', 'correct-password'),
    ).rejects.toThrow('Invalid email or password.');
  });
});
