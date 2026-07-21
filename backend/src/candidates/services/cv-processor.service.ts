import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from '../../shared/embeddings/embeddings.service';
import { PdfTextExtractorService } from '../../shared/pdf/pdf-text-extractor.service';
import { CvParserService } from './cv-parser.service';
import { CvStorageService } from './cv-storage.service';

/**
 * Background job body (run exactly once per CandidateProfile, off the
 * upload HTTP request via BackgroundJobQueueService): extract -> parse ->
 * embed -> READY. Mirrors DocumentProcessorService's success/failure
 * pattern — only flips cvStatus on full success, records cvProcessingError
 * and leaves the row FAILED (not silently stuck) otherwise.
 */
@Injectable()
export class CvProcessorService {
  private readonly logger = new Logger(CvProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CvStorageService,
    private readonly pdfExtractor: PdfTextExtractorService,
    private readonly parser: CvParserService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async process(candidateProfileId: string): Promise<void> {
    const profile = await this.prisma.candidateProfile.findUniqueOrThrow({
      where: { id: candidateProfileId },
    });

    try {
      if (!profile.resumeFilePath) {
        throw new Error('CandidateProfile has no resumeFilePath to process.');
      }

      const buffer = await this.storage.read(profile.resumeFilePath);
      const pages = await this.pdfExtractor.extractPages(buffer);
      const resumeText = pages
        .map((p) => p.text)
        .join('\n')
        .trim();

      if (!resumeText) {
        throw new Error(
          'No extractable text found in this CV (it may be a scanned image without a text layer).',
        );
      }

      const parsed = await this.parser.parse(resumeText);
      const embedding = await this.embeddings.embed(resumeText);
      const vectorLiteral = this.embeddings.toVectorLiteral(embedding);

      await this.prisma.candidateProfile.update({
        where: { id: candidateProfileId },
        data: {
          resumeText,
          // Prisma's Json input type structurally rejects these generated
          // DTO/array shapes directly (missing index signature); routing
          // through `unknown` is required, not redundant, despite what
          // no-unnecessary-type-assertion assumes here.
          /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
          resumePagesJson: pages as unknown as object,
          extractedDataJson: parsed as unknown as object,
          educationJson: parsed.education as unknown as object,
          /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */
          experienceYears: parsed.experienceYears,
          cvStatus: 'READY',
          cvProcessingError: null,
        },
      });
      await this.prisma.$executeRaw`
        UPDATE "CandidateProfile" SET "resumeEmbedding" = ${vectorLiteral}::vector WHERE id = ${candidateProfileId}
      `;

      this.logger.log(
        `Processed CV for candidate profile ${candidateProfileId}: ${parsed.skills.length} skills extracted.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `CV processing failed for candidate profile ${candidateProfileId}: ${message}`,
      );
      await this.prisma.candidateProfile.update({
        where: { id: candidateProfileId },
        data: { cvStatus: 'FAILED', cvProcessingError: message },
      });
    }
  }
}
