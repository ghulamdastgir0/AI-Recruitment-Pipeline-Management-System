import { MatchingService } from '../../matching/matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from '../../shared/embeddings/embeddings.service';
import { PdfTextExtractorService } from '../../shared/pdf/pdf-text-extractor.service';
import { CvParserService } from './cv-parser.service';
import { CvProcessorService } from './cv-processor.service';
import { CvStorageService } from './cv-storage.service';

const PARSED = {
  name: 'Jane Candidate',
  email: 'jane@example.com',
  phone: null,
  skills: ['TypeScript'],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  experienceYears: 2,
};

function buildService() {
  const prisma = {
    candidateProfile: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'cand-1',
        resumeFilePath: '/storage/cvs/x.pdf',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PrismaService>;
  const storage = {
    read: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  } as unknown as jest.Mocked<CvStorageService>;
  const pdfExtractor = {
    extractPages: jest.fn().mockResolvedValue([{ text: 'resume text' }]),
  } as unknown as jest.Mocked<PdfTextExtractorService>;
  const parser = {
    parse: jest.fn().mockResolvedValue(PARSED),
  } as unknown as jest.Mocked<CvParserService>;
  const embeddings = {
    embed: jest.fn().mockResolvedValue([0.1, 0.2]),
    toVectorLiteral: jest.fn().mockReturnValue('[0.1,0.2]'),
  } as unknown as jest.Mocked<EmbeddingsService>;
  const matching = {
    matchAllPendingApplications: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MatchingService>;

  return {
    service: new CvProcessorService(
      prisma,
      storage,
      pdfExtractor,
      parser,
      embeddings,
      matching,
    ),
    prisma,
    matching,
  };
}

describe('CvProcessorService', () => {
  it('auto-triggers scoring for the candidate once the CV reaches READY', async () => {
    const { service, matching } = buildService();

    await service.process('cand-1');

    expect(matching.matchAllPendingApplications).toHaveBeenCalledWith('cand-1');
  });

  it('does not mark the CV FAILED if auto-matching throws after a successful parse', async () => {
    const { service, prisma, matching } = buildService();
    (matching.matchAllPendingApplications as jest.Mock).mockRejectedValue(
      new Error('scoring blew up'),
    );

    await service.process('cand-1');

    expect(prisma.candidateProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cvStatus: 'READY' }),
      }),
    );
    expect(prisma.candidateProfile.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cvStatus: 'FAILED' }),
      }),
    );
  });
});
