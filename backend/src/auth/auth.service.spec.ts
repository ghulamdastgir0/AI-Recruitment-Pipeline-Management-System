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
    role: 'ADMIN' as const,
  };

  function buildService() {
    const prisma = {
      user: { findUnique: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
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
      role: 'ADMIN',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'hr@example.com',
      role: 'ADMIN',
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
});
