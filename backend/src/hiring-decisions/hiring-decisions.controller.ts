import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import { DecideApplicationDto } from './dto/decide-application.dto';
import { MarkManagerReviewedDto } from './dto/mark-manager-reviewed.dto';
import { SendOfferLetterDto } from './dto/send-offer-letter.dto';
import {
  DecideApplicationResult,
  HiringDecisionsService,
  MarkManagerReviewedResult,
} from './hiring-decisions.service';

/**
 * HR's post-interview actions on a candidate — move to manager review, then
 * select/reject/advance to a further (human) interview round — plus the
 * assigned Hiring Manager's one action: closing out manager review with a
 * required comment (markManagerReviewed, below). Every other route here
 * stays HR/Admin-only per the class-level @Roles.
 */
@ApiTags('hiring-decisions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, JobAssignmentGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN')
@Controller('job-postings/:jobPostingId/candidates/:candidateId')
export class HiringDecisionsController {
  constructor(private readonly decisions: HiringDecisionsService) {}

  @Post('decision')
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

  @Post('offer-letter')
  @ApiOperation({
    summary:
      "Send the offer letter email to a SELECTED candidate. Moves the application to HIRED and increments the job's hired count (which may auto-close the posting once its hiring target is met).",
  })
  async sendOfferLetter(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: SendOfferLetterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DecideApplicationResult> {
    return this.decisions.sendOfferLetter(
      candidateId,
      jobPostingId,
      user.id,
      body.offerDetails,
    );
  }

  @Post('manager-review')
  @ApiOperation({
    summary:
      'Move a candidate (whose AI interview just completed) into manager review, ahead of a final decision.',
  })
  async moveToManagerReview(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ applicationId: string; status: string }> {
    return this.decisions.moveToManagerReview(
      candidateId,
      jobPostingId,
      user.id,
    );
  }

  @Post('manager-reviewed')
  @Roles('HIRING_MANAGER')
  @ApiOperation({
    summary:
      "The assigned Hiring Manager's required comment closing out manager review — posts the comment and advances the application to MANAGER_REVIEWED, which HR's decision endpoint requires.",
  })
  async markManagerReviewed(
    @Param('jobPostingId') jobPostingId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: MarkManagerReviewedDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarkManagerReviewedResult> {
    return this.decisions.markManagerReviewed(
      candidateId,
      jobPostingId,
      user.id,
      body.comment,
    );
  }
}
