import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

export interface SavedCvFile {
  /** Local disk: an absolute path. GCS: the object key within the bucket. Either way, opaque — pass it back to read()/remove() unchanged. */
  filePath: string;
}

/**
 * Persists uploaded CV originals, mirroring documents/services/file-storage.service.ts's
 * GCS-or-local-disk pattern but pointed at its own directory/key prefix —
 * CVs and policy PDFs are different retention/access concerns even though
 * the storage mechanics are identical.
 */
@Injectable()
export class CvStorageService {
  private readonly baseDir: string;
  private readonly bucketName?: string;
  private readonly storage?: Storage;
  private readonly keyPrefix = 'cvs/';

  constructor(config: ConfigService) {
    this.baseDir = path.resolve(
      config.get<string>('CV_STORAGE_DIR') ?? './storage/cvs',
    );
    this.bucketName = config.get<string>('GCS_BUCKET_NAME') || undefined;
    if (this.bucketName) this.storage = new Storage();
  }

  async save(buffer: Buffer, suggestedFileName: string): Promise<SavedCvFile> {
    const safeName = suggestedFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const name = `${randomUUID()}-${safeName}`;
    if (this.storage && this.bucketName) {
      const key = this.keyPrefix + name;
      await this.storage.bucket(this.bucketName).file(key).save(buffer);
      return { filePath: key };
    }
    await mkdir(this.baseDir, { recursive: true });
    const filePath = path.join(this.baseDir, name);
    await writeFile(filePath, buffer);
    return { filePath };
  }

  async read(filePath: string): Promise<Buffer> {
    if (this.storage && this.bucketName) {
      const [buffer] = await this.storage
        .bucket(this.bucketName)
        .file(filePath)
        .download();
      return buffer;
    }
    return readFile(filePath);
  }

  /** Best-effort delete — used when a job posting is deleted and a candidate's CV becomes orphaned (see JobPostingsService.delete). */
  async remove(filePath: string): Promise<void> {
    if (this.storage && this.bucketName) {
      try {
        await this.storage.bucket(this.bucketName).file(filePath).delete();
      } catch (err) {
        if ((err as { code?: number }).code !== 404) throw err;
      }
      return;
    }
    try {
      await unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
