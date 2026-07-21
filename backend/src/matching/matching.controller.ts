import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RankCandidatesQueryDto } from './dto/rank-candidates-query.dto';
import { MatchResultView, MatchingService } from './matching.service';
import { RankedCandidate, RankingService } from './ranking.service';

/**
 * Read-only, scored view of candidates for a job posting. Hiring Managers
 * can't use the LLM assistant, so this is their plain REST surface onto the
 * same RankingService/MatchingService the assistant's tools already call —
 * no new business logic, just re-exposure with JobAssignmentGuard scoping.
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
}
