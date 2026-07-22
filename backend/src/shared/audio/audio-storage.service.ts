import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SavedAudioFile {
  filePath: string;
}

/**
 * Persists interview audio (TTS-generated questions + candidate answer
 * recordings), mirroring candidates/services/cv-storage.service.ts's pattern
 * pointed at its own directory — different retention/access concern.
 */
@Injectable()
export class AudioStorageService {
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir = path.resolve(
      config.get<string>('INTERVIEW_AUDIO_STORAGE_DIR') ??
        './storage/interview-audio',
    );
  }

  async save(
    buffer: Buffer,
    suggestedFileName: string,
  ): Promise<SavedAudioFile> {
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
