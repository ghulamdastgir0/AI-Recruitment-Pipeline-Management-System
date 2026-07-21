import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditEntry {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: unknown;
}

/** One row per tool execution / confirmed / cancelled assistant action, so every mutation is attributable to a real HR user. */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: RecordAuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        detailsJson:
          entry.details === undefined ? undefined : (entry.details as object),
      },
    });
  }
}
