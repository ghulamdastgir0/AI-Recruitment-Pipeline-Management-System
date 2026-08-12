import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

export interface SavedFile {
  /** Local disk: an absolute path. GCS: the object key within the bucket. Either way, opaque — pass it back to read()/remove() unchanged. */
  filePath: string;
}

/**
 * Persists uploaded document originals — GCS-backed when GCS_BUCKET_NAME is
 * set, local disk otherwise. Local disk alone is fine for dev, but Cloud
 * Run's filesystem is ephemeral and instance-local: a redeploy/restart wipes
 * it, and a file saved by one instance is invisible to another, so any real
 * deployment needs the bucket. Uses Application Default Credentials — no key
 * file needed when this runs as a Cloud Run service with bucket access.
 */
@Injectable()
export class FileStorageService {
  private readonly baseDir: string;
  private readonly bucketName?: string;
  private readonly storage?: Storage;
  private readonly keyPrefix = 'documents/';

  constructor(config: ConfigService) {
    this.baseDir = path.resolve(
      config.get<string>('DOCUMENT_STORAGE_DIR') ?? './storage/documents',
    );
    this.bucketName = config.get<string>('GCS_BUCKET_NAME') || undefined;
    if (this.bucketName) this.storage = new Storage();
  }

  async save(buffer: Buffer, suggestedFileName: string): Promise<SavedFile> {
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
