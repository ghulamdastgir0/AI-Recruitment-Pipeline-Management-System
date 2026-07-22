import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  InterviewSessionService,
  InterviewTranscriptView,
} from './services/interview-session.service';

/**
 * Staff-facing view of a completed/in-progress AI interview — read-only, so
 * Hiring Managers can review it before adding a CandidateComment, and
 * HR/Admin before making a hiring decision.
 */
@ApiTags('interviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, JobAssignmentGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER')
@Controller('job-postings/:jobPostingId/candidates/:candidateId/interview')
export class InterviewTranscriptController {
  constructor(private readonly sessions: InterviewSessionService) {}

  @Get()
  @ApiOperation({
    summary:
      'Full AI interview transcript, per-skill scores, and grading justifications for one candidate against this job posting.',
  })
  async getTranscript(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
  ): Promise<InterviewTranscriptView> {
    return this.sessions.getTranscript(candidateId, jobPostingId);
  }
}
