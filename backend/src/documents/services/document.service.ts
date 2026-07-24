import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Document } from '../../generated/prisma/client';
import { DocumentStatus } from '../../generated/prisma/enums';
import { BackgroundJobQueueService } from '../../shared/background-jobs/background-job-queue.service';
import { DOCUMENT_PROCESSING_JOB_TYPE } from './document-processor.service';
import { FileStorageService } from './file-storage.service';

export interface UploadedPdf {
  buffer: Buffer;
  originalname: string;
}

const PDF_MAGIC_BYTES = '%PDF-';

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly jobQueue: BackgroundJobQueueService,
    private readonly audit: AuditLogService,
  ) {}

  /** Uploads the first version of a brand-new document name. */
  async uploadNewDocument(
    name: string,
    file: UploadedPdf,
    uploadedByUserId?: string,
  ): Promise<Document> {
    this.assertIsPdf(file);

    const existing = await this.prisma.document.findFirst({ where: { name } });
    if (existing) {
      throw new ConflictException(
        `A document named "${name}" already exists (as of version ${existing.version}). Upload a new version via POST /admin/documents/${existing.id}/versions instead.`,
      );
    }

    const document = await this.createVersion(name, file, 1, uploadedByUserId);
    if (uploadedByUserId) {
      await this.audit.record({
        actorUserId: uploadedByUserId,
        action: 'document.uploaded',
        resourceType: 'Document',
        resourceId: document.id,
        details: { name, version: document.version },
      });
    }
    return document;
  }

  /** Uploads a newer version superseding the document family that `existingDocumentId` belongs to. */
  async uploadNewVersion(
    existingDocumentId: string,
    file: UploadedPdf,
    uploadedByUserId?: string,
  ): Promise<Document> {
    this.assertIsPdf(file);

    const existing = await this.prisma.document.findUnique({
      where: { id: existingDocumentId },
    });
    if (!existing) {
      throw new NotFoundException(
        `No document found with id "${existingDocumentId}".`,
      );
    }

    const latest = await this.prisma.document.findFirst({
      where: { name: existing.name },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const document = await this.createVersion(
      existing.name,
      file,
      nextVersion,
      uploadedByUserId,
    );
    if (uploadedByUserId) {
      await this.audit.record({
        actorUserId: uploadedByUserId,
        action: 'document.version_added',
        resourceType: 'Document',
        resourceId: document.id,
        details: { name: existing.name, version: document.version },
      });
    }
    return document;
  }

  async list(filter: {
    name?: string;
    status?: DocumentStatus;
  }): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: {
        ...(filter.name ? { name: filter.name } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
  }

  async getById(id: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException(`No document found with id "${id}".`);
    }
    return document;
  }

  /** Activates or deactivates a specific version. Activating one version retires any other ACTIVE version of the same name. */
  async setStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    actorUserId: string,
  ): Promise<Document> {
    const document = await this.getById(id);

    if (document.status === 'PROCESSING') {
      throw new ConflictException(
        'This document version is still being processed and cannot change status yet.',
      );
    }

    if (status === 'ACTIVE') {
      await this.prisma.$transaction([
        this.prisma.document.updateMany({
          where: { name: document.name, status: 'ACTIVE', NOT: { id } },
          data: { status: 'INACTIVE' },
        }),
        this.prisma.document.update({
          where: { id },
          data: { status: 'ACTIVE' },
        }),
      ]);
    } else {
      await this.prisma.document.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });
    }

    await this.audit.record({
      actorUserId,
      action: 'document.status_changed',
      resourceType: 'Document',
      resourceId: id,
      details: { name: document.name, status },
    });

    return this.getById(id);
  }

  private async createVersion(
    name: string,
    file: UploadedPdf,
    version: number,
    uploadedByUserId?: string,
  ): Promise<Document> {
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    // Idempotency: an identical re-upload of a version that already
    // processed successfully is a no-op, not a second processing run.
    const duplicate = await this.prisma.document.findFirst({
      where: { name, contentHash, status: { not: 'FAILED' } },
      orderBy: { version: 'desc' },
    });
    if (duplicate) {
      return duplicate;
    }

    const { filePath } = await this.storage.save(
      file.buffer,
      `${name}-v${version}-${file.originalname}`,
    );

    const document = await this.prisma.document.create({
      data: {
        name,
        originalFileName: file.originalname,
        filePath,
        contentHash,
        version,
        status: 'PROCESSING',
        uploadedByUserId: uploadedByUserId ?? null,
      },
    });

    await this.jobQueue.enqueue(DOCUMENT_PROCESSING_JOB_TYPE, document.id);

    return document;
  }

  private assertIsPdf(file: UploadedPdf): void {
    if (
      file.buffer.subarray(0, PDF_MAGIC_BYTES.length).toString('latin1') !==
      PDF_MAGIC_BYTES
    ) {
      throw new BadRequestException('The uploaded file is not a valid PDF.');
    }
  }
}
