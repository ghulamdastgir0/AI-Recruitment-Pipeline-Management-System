import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import { AssignHiringManagerDto } from './dto/assign-hiring-manager.dto';
import { HiringManagerAssignmentResponseDto } from './dto/hiring-manager-assignment-response.dto';
import {
  AssignmentView,
  JobPostingAssignmentsService,
} from './job-posting-assignments.service';

/** Assigning Hiring Managers to job postings — a Super-Admin-only permission ("Assign Hiring Managers to job postings" appears only under SUPER_ADMIN). */
@ApiTags('job-posting-assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('job-postings/:jobPostingId/hiring-managers')
export class JobPostingAssignmentsController {
  constructor(private readonly assignments: JobPostingAssignmentsService) {}

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Assign a Hiring Manager to a job posting.' })
  @ApiResponse({ status: 201, type: HiringManagerAssignmentResponseDto })
  async assign(
    @Param('jobPostingId') jobPostingId: string,
    @Body() body: AssignHiringManagerDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssignmentView> {
    return this.assignments.assign(
      jobPostingId,
      body.hiringManagerUserId,
      user.id,
    );
  }

  @Delete(':hiringManagerUserId')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Unassign a Hiring Manager from a job posting.' })
  @ApiResponse({ status: 200 })
  async unassign(
    @Param('jobPostingId') jobPostingId: string,
    @Param('hiringManagerUserId') hiringManagerUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ unassigned: true }> {
    await this.assignments.unassign(jobPostingId, hiringManagerUserId, user.id);
    return { unassigned: true };
  }

  @Get()
  @Roles('SUPER_ADMIN', 'HR_ADMIN')
  @ApiOperation({
    summary: 'List Hiring Managers assigned to a job posting.',
  })
  @ApiResponse({ status: 200, type: [HiringManagerAssignmentResponseDto] })
  async list(
    @Param('jobPostingId') jobPostingId: string,
  ): Promise<AssignmentView[]> {
    return this.assignments.listForJob(jobPostingId);
  }
}
