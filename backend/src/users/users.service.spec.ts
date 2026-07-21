import { ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

function buildService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  return { service: new UsersService(prisma, audit), prisma, audit };
}

const HR_ADMIN_ROW = {
  id: 'user-1',
  email: 'hr@example.com',
  passwordHash: 'hash',
  firstName: 'HR',
  lastName: 'Admin',
  role: 'HR_ADMIN',
  isActive: true,
  createdAt: new Date(),
};

const SUPER_ADMIN_ROW = { ...HR_ADMIN_ROW, id: 'super-1', role: 'SUPER_ADMIN' };

describe('CreateUserDto', () => {
  it('rejects role: SUPER_ADMIN (only HR_ADMIN/HIRING_MANAGER are creatable this way)', async () => {
    const dto = plainToInstance(CreateUserDto, {
      email: 'x@example.com',
      password: 'password123',
      firstName: 'X',
      lastName: 'Y',
      role: 'SUPER_ADMIN',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('accepts HR_ADMIN and HIRING_MANAGER', async () => {
    for (const role of ['HR_ADMIN', 'HIRING_MANAGER']) {
      const dto = plainToInstance(CreateUserDto, {
        email: 'x@example.com',
        password: 'password123',
        firstName: 'X',
        lastName: 'Y',
        role,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'role')).toBe(false);
    }
  });
});

describe('UsersService', () => {
  describe('create', () => {
    it('creates an HR_ADMIN/HIRING_MANAGER user and audit-logs user.invited', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(HR_ADMIN_ROW);

      const result = await service.create(
        {
          email: 'hr@example.com',
          password: 'password123',
          firstName: 'HR',
          lastName: 'Admin',
          role: 'HR_ADMIN',
        },
        'actor-1',
      );

      expect(result.role).toBe('HR_ADMIN');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'actor-1',
          action: 'user.invited',
        }),
      );
    });

    it('rejects a duplicate email', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(HR_ADMIN_ROW);

      await expect(
        service.create(
          {
            email: 'hr@example.com',
            password: 'password123',
            firstName: 'HR',
            lastName: 'Admin',
            role: 'HR_ADMIN',
          },
          'actor-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update / setStatus / remove', () => {
    it('rejects editing a SUPER_ADMIN target', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN_ROW);

      await expect(
        service.update('super-1', { firstName: 'New' }, 'actor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects deactivating a SUPER_ADMIN target', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN_ROW);

      await expect(
        service.setStatus('super-1', false, 'actor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects removing a SUPER_ADMIN target', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN_ROW);

      await expect(service.remove('super-1', 'actor-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('audit-logs user.role_changed only when the role actually changes', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(HR_ADMIN_ROW);
      (prisma.user.update as jest.Mock).mockResolvedValue({
        ...HR_ADMIN_ROW,
        role: 'HIRING_MANAGER',
      });

      await service.update('user-1', { role: 'HIRING_MANAGER' }, 'actor-1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.role_changed' }),
      );
    });

    it('deactivates a non-SUPER_ADMIN user and audit-logs user.deactivated', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(HR_ADMIN_ROW);
      (prisma.user.update as jest.Mock).mockResolvedValue({
        ...HR_ADMIN_ROW,
        isActive: false,
      });

      const result = await service.setStatus('user-1', false, 'actor-1');

      expect(result.isActive).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.deactivated' }),
      );
    });

    it('remove() deactivates and audit-logs user.removed on top of user.deactivated', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(HR_ADMIN_ROW);
      (prisma.user.update as jest.Mock).mockResolvedValue({
        ...HR_ADMIN_ROW,
        isActive: false,
      });

      await service.remove('user-1', 'actor-1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.deactivated' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.removed' }),
      );
    });
  });
});
