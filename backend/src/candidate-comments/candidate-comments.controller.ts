import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import {
  CandidateCommentsService,
  CandidateCommentView,
} from './candidate-comments.service';
import { CreateCandidateCommentDto } from './dto/create-candidate-comment.dto';

/**
 * Hiring Manager feedback on a candidate, scoped to one job posting.
 * Creation is Hiring-Manager-only (the literal grant — "add comments" is
 * listed only under Hiring Manager); Admins retain read-only oversight.
 */
@ApiTags('candidate-comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, JobAssignmentGuard)
@Controller('job-postings/:jobPostingId/candidates/:candidateId/comments')
export class CandidateCommentsController {
  constructor(private readonly comments: CandidateCommentsService) {}

  @Post()
  @Roles('HIRING_MANAGER')
  @ApiOperation({
    summary: 'Add a comment on a candidate for this job posting.',
  })
  @ApiResponse({ status: 201 })
  async add(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: CreateCandidateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidateCommentView> {
    return this.comments.add(candidateId, jobPostingId, user.id, body.content);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER')
  @ApiOperation({
    summary:
      "List comments on a candidate for this job posting (all assigned Hiring Managers see each other's comments).",
  })
  @ApiResponse({ status: 200 })
  async list(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
  ): Promise<CandidateCommentView[]> {
    return this.comments.list(candidateId, jobPostingId);
  }
}
