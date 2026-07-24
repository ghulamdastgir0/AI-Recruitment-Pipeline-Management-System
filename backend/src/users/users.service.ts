import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 12;

export interface UserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
}

export interface HiringManagerOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateUserDto, actorUserId: string): Promise<UserView> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(
        `A user with email "${dto.email}" already exists.`,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
      },
    });

    await this.audit.record({
      actorUserId,
      action: 'user.invited',
      resourceType: 'User',
      resourceId: user.id,
      details: { email: user.email, role: user.role },
    });

    return toView(user);
  }

  async list(): Promise<UserView[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return users.map(toView);
  }

  /**
   * Least-privilege read for the job-posting Hiring-Manager-assignment
   * picker — HR_ADMIN needs to see who's assignable without the full
   * admin/users roster (other admins, deactivated accounts, etc.).
   */
  async listHiringManagers(): Promise<HiringManagerOption[]> {
    const users = await this.prisma.user.findMany({
      where: { role: 'HIRING_MANAGER', isActive: true },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return users;
  }

  async getById(id: string): Promise<UserView> {
    const user = await this.getUserOrThrow(id);
    return toView(user);
  }

  /**
   * Case-insensitive Hiring Manager lookup by email, for the assistant's
   * assignHiringManager tool — HR knows the person's email, not their raw
   * user id, and this only ever resolves to an existing, active Hiring
   * Manager account (never creates one).
   */
  async findHiringManagerByEmail(email: string): Promise<HiringManagerOption> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        role: 'HIRING_MANAGER',
        isActive: true,
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) {
      throw new NotFoundException(
        `No active Hiring Manager account found with email "${email}".`,
      );
    }
    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorUserId: string,
  ): Promise<UserView> {
    const target = await this.getUserOrThrow(id);
    this.assertNotSuperAdmin(target.role);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
      },
    });

    await this.audit.record({
      actorUserId,
      action: 'user.updated',
      resourceType: 'User',
      resourceId: id,
      details: { changes: dto },
    });
    if (dto.role !== undefined && dto.role !== target.role) {
      await this.audit.record({
        actorUserId,
        action: 'user.role_changed',
        resourceType: 'User',
        resourceId: id,
        details: { from: target.role, to: dto.role },
      });
    }

    return toView(user);
  }

  async setStatus(
    id: string,
    isActive: boolean,
    actorUserId: string,
  ): Promise<UserView> {
    const target = await this.getUserOrThrow(id);
    this.assertNotSuperAdmin(target.role);

    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
    });

    await this.audit.record({
      actorUserId,
      action: isActive ? 'user.reactivated' : 'user.deactivated',
      resourceType: 'User',
      resourceId: id,
    });

    return toView(user);
  }

  /**
   * "Remove" is implemented as deactivation, not a physical delete — Job.createdByUserId,
   * AuditLog.actorUserId, etc. are required FKs, so hard-deleting a user with any
   * history would either orphan those rows or cascade-destroy job postings/audit trail.
   */
  async remove(id: string, actorUserId: string): Promise<UserView> {
    const result = await this.setStatus(id, false, actorUserId);
    await this.audit.record({
      actorUserId,
      action: 'user.removed',
      resourceType: 'User',
      resourceId: id,
    });
    return result;
  }

  private async getUserOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No user found with id "${id}".`);
    }
    return user;
  }

  private assertNotSuperAdmin(role: string): void {
    if (role === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Super Admin accounts cannot be modified through this endpoint.',
      );
    }
  }
}

function toView(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
}): UserView {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}
