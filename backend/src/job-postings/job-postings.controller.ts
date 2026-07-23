import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JobIdParam } from '../auth/decorators/job-id-param.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobAssignmentGuard } from '../auth/guards/job-assignment.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateJobPostingDto } from './dto/create-job-posting.dto';
import { JobPostingResponseDto } from './dto/job-posting-response.dto';
import { UpdateJobPostingDto } from './dto/update-job-posting.dto';
import { JobPostingsService } from './job-postings.service';

/**
 * Direct HTTP surface for job postings — independent of the LLM assistant,
 * useful for a future dashboard and for testing the underlying logic
 * without going through tool-calling. The assistant's tool registry calls
 * this same JobPostingsService directly.
 */
@ApiTags('job-postings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'HR_ADMIN')
@Controller('job-postings')
export class JobPostingsController {
  constructor(private readonly jobPostings: JobPostingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new job posting (status starts as DRAFT).',
  })
  @ApiResponse({ status: 201, type: JobPostingResponseDto })
  async create(
    @Body() body: CreateJobPostingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobPostingResponseDto> {
    return this.jobPostings.create(body, user.id);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER')
  @ApiOperation({
    summary:
      'List job postings, optionally filtered by status. Hiring Managers only see job postings they are assigned to.',
  })
  @ApiResponse({ status: 200, type: [JobPostingResponseDto] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ): Promise<JobPostingResponseDto[]> {
    return this.jobPostings.list({
      status,
      assignedToUserId: user.role === 'HIRING_MANAGER' ? user.id : undefined,
    });
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER')
  @JobIdParam('id')
  @UseGuards(JobAssignmentGuard)
  @ApiOperation({
    summary:
      'Get a single job posting. Hiring Managers must be assigned to it.',
  })
  @ApiResponse({ status: 200, type: JobPostingResponseDto })
  async getOne(@Param('id') id: string): Promise<JobPostingResponseDto> {
    return this.jobPostings.getById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a job posting. Changing `status` here is a direct write (no confirmation gate) — the assistant enforces that gate itself before calling this.',
  })
  @ApiResponse({ status: 200, type: JobPostingResponseDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateJobPostingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobPostingResponseDto> {
    return this.jobPostings.update(id, body, user.id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a job posting (sets status=PUBLISHED).' })
  @ApiResponse({ status: 200, type: JobPostingResponseDto })
  async publish(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobPostingResponseDto> {
    return this.jobPostings.publish(id, user.id);
  }

  @Post(':id/pause')
  @ApiOperation({
    summary:
      'Pause a published job posting (sets status=PAUSED). Immediately hidden from the public job list; existing applications are untouched. Resume with :id/resume.',
  })
  @ApiResponse({ status: 200, type: JobPostingResponseDto })
  async pause(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobPostingResponseDto> {
    return this.jobPostings.pause(id, user.id);
  }

  @Post(':id/resume')
  @ApiOperation({
    summary: 'Resume a paused job posting (sets status=PUBLISHED).',
  })
  @ApiResponse({ status: 200, type: JobPostingResponseDto })
  async resume(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobPostingResponseDto> {
    return this.jobPostings.resume(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Permanently delete a job posting and every application/interview/match record tied to it. Irreversible.',
  })
  @ApiResponse({ status: 204 })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.jobPostings.delete(id, user.id);
  }
}
