import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SavedCvFile {
  filePath: string;
}

/**
 * Persists uploaded CV originals, mirroring documents/services/file-storage.service.ts's
 * pattern but pointed at its own directory — CVs and policy PDFs are different
 * retention/access concerns even though the mechanics are identical.
 */
@Injectable()
export class CvStorageService {
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir = path.resolve(
      config.get<string>('CV_STORAGE_DIR') ?? './storage/cvs',
    );
  }

  async save(buffer: Buffer, suggestedFileName: string): Promise<SavedCvFile> {
    await mkdir(this.baseDir, { recursive: true });
    const safeName = suggestedFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(this.baseDir, `${randomUUID()}-${safeName}`);
    await writeFile(filePath, buffer);
    return { filePath };
  }

  async read(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }
}
