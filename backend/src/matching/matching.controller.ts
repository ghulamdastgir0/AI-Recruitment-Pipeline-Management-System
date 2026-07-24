import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CvStorageService } from '../candidates/services/cv-storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RankCandidatesQueryDto } from './dto/rank-candidates-query.dto';
import { MatchResultView, MatchingService } from './matching.service';
import { RankedCandidate, RankingService } from './ranking.service';

/**
 * Read-only, scored view of candidates for a job posting, plus the
 * authenticated CV download. Hiring Managers can't use the LLM assistant,
 * so this is their plain REST surface onto the same RankingService/
 * MatchingService the assistant's tools already call. Same JobAssignmentGuard
 * scoping as everything else here — HR_ADMIN/SUPER_ADMIN reach every
 * candidate's CV, HIRING_MANAGER only those on jobs they're assigned to.
 */
@ApiTags('matching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, JobAssignmentGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER')
@Controller('job-postings/:jobPostingId/candidates')
export class MatchingController {
  constructor(
    private readonly ranking: RankingService,
    private readonly matching: MatchingService,
    private readonly cvStorage: CvStorageService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Ranked candidates for a job posting, with scores and recommendations.',
  })
  @ApiResponse({ status: 200 })
  async list(
    @Param('jobPostingId') jobPostingId: string,
    @Query() query: RankCandidatesQueryDto,
  ): Promise<RankedCandidate[]> {
    return this.ranking.rank(jobPostingId, {
      minScore: query.minScore,
      recommendation: query.recommendation,
      limit: query.limit,
    });
  }

  @Get(':candidateId/match')
  @ApiOperation({
    summary:
      'Full score breakdown/evidence for one candidate against this job posting.',
  })
  @ApiResponse({ status: 200 })
  async getMatch(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
  ): Promise<MatchResultView> {
    return this.matching.getLatestExplanation(candidateId, jobPostingId);
  }

  @Get(':candidateId/cv')
  @ApiOperation({
    summary: "Download the candidate's original CV (PDF).",
  })
  @ApiResponse({ status: 200 })
  async downloadCv(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
  ): Promise<StreamableFile> {
    const { filePath, displayName } = await this.matching.getResumeFile(
      candidateId,
      jobPostingId,
    );
    const buffer = await this.cvStorage.read(filePath);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${displayName}"`,
    });
  }
}
