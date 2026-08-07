import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
      findMany: jest.fn(),
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

  describe('getOwnProfile / updateOwnProfile / changeOwnPassword', () => {
    it('getOwnProfile returns even a SUPER_ADMIN row (unlike update())', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN_ROW);

      const result = await service.getOwnProfile('super-1');

      expect(result.id).toBe('super-1');
    });

    it("updateOwnProfile edits a SUPER_ADMIN's own name without the update() role block", async () => {
      const { service, prisma, audit } = buildService();
      (prisma.user.update as jest.Mock).mockResolvedValue({
        ...SUPER_ADMIN_ROW,
        firstName: 'New',
      });

      const result = await service.updateOwnProfile('super-1', {
        firstName: 'New',
      });

      expect(result.firstName).toBe('New');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'super-1',
          action: 'user.profile_updated',
        }),
      );
    });

    it('changeOwnPassword rejects an incorrect current password', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...HR_ADMIN_ROW,
        passwordHash: bcrypt.hashSync('correct-password', 4),
      });

      await expect(
        service.changeOwnPassword('user-1', {
          currentPassword: 'wrong-password',
          newPassword: 'a-new-strong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('changeOwnPassword hashes and stores the new password, then audit-logs user.password_changed', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...HR_ADMIN_ROW,
        passwordHash: bcrypt.hashSync('correct-password', 4),
      });
      (prisma.user.update as jest.Mock).mockResolvedValue(HR_ADMIN_ROW);

      await service.changeOwnPassword('user-1', {
        currentPassword: 'correct-password',
        newPassword: 'a-new-strong-password',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { passwordHash: expect.any(String) },
        }),
      );
      const [updateCall] = (prisma.user.update as jest.Mock).mock.calls[0] as [
        { data: { passwordHash: string } },
      ];
      const newHash = updateCall.data.passwordHash;
      expect(bcrypt.compareSync('a-new-strong-password', newHash)).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'user.password_changed',
        }),
      );
    });
  });

  describe('listHiringManagers', () => {
    it('queries only active HIRING_MANAGER users, selecting a minimal field set', async () => {
      const { service, prisma } = buildService();
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'hm-1',
          firstName: 'Manager',
          lastName: 'User',
          email: 'manager@example.com',
        },
      ]);

      const result = await service.listHiringManagers();

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: 'HIRING_MANAGER', isActive: true },
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
      );
      expect(result).toEqual([
        {
          id: 'hm-1',
          firstName: 'Manager',
          lastName: 'User',
          email: 'manager@example.com',
        },
      ]);
    });
  });
});
