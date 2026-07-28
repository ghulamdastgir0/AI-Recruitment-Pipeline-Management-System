import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SavedFile {
  /** Absolute path on disk where the original file is permanently stored. */
  filePath: string;
}

/**
 * Persists uploaded document originals. Local disk today; swap the
 * implementation (e.g. S3) behind this same interface if storage needs
 * to move off the app server without touching callers.
 */
@Injectable()
export class FileStorageService {
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir = path.resolve(
      config.get<string>('DOCUMENT_STORAGE_DIR') ?? './storage/documents',
    );
  }

  async save(buffer: Buffer, suggestedFileName: string): Promise<SavedFile> {
    await mkdir(this.baseDir, { recursive: true });
    const safeName = suggestedFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(this.baseDir, `${randomUUID()}-${safeName}`);
    await writeFile(filePath, buffer);
    return { filePath };
  }

  async read(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  async remove(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
