import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import { DecideApplicationDto } from './dto/decide-application.dto';
import {
  DecideApplicationResult,
  HiringDecisionsService,
} from './hiring-decisions.service';

/**
 * HR's final call on a candidate — select, reject, or advance to a further
 * (human) interview round. Hiring Managers stay comment-only per existing
 * RBAC (CandidateCommentsModule) — they don't send decision emails.
 */
@ApiTags('hiring-decisions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, JobAssignmentGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN')
@Controller('job-postings/:jobPostingId/candidates/:candidateId/decision')
export class HiringDecisionsController {
  constructor(private readonly decisions: HiringDecisionsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Select, reject, or advance a candidate to a further interview round. Auto-generates and sends the matching email; nextRoundTime/nextRoundDeadline are required for NEXT_ROUND.',
  })
  async decide(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: DecideApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DecideApplicationResult> {
    return this.decisions.decide(candidateId, jobPostingId, user.id, body);
  }
}
