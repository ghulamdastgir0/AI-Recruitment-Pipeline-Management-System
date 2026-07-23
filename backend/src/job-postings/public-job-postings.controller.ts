import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PublicJobPostingDto } from './dto/public-job-posting.dto';
import {
  JobPostingsService,
  JobPostingWithSkills,
} from './job-postings.service';

/**
 * Public, unauthenticated job browsing — no candidate accounts/login exist
 * anywhere in this system (same reasoning as CandidatesController). Only
 * ever exposes PUBLISHED postings, and only the fields a candidate should
 * see (see PublicJobPostingDto).
 */
@ApiTags('jobs')
@Controller('jobs')
export class PublicJobPostingsController {
  constructor(private readonly jobPostings: JobPostingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List currently published job postings. No authentication required.',
  })
  @ApiResponse({ status: 200, type: [PublicJobPostingDto] })
  async list(): Promise<PublicJobPostingDto[]> {
    const jobs = await this.jobPostings.list({ status: 'PUBLISHED' });
    return jobs.map(toPublicDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single published job posting. No authentication required.',
  })
  @ApiResponse({ status: 200, type: PublicJobPostingDto })
  async getOne(@Param('id') id: string): Promise<PublicJobPostingDto> {
    const job = await this.jobPostings.getById(id);
    // Treat a non-published job the same as "doesn't exist" — same
    // reasoning as CvUploadService.uploadCv not leaking unannounced roles.
    if (job.status !== 'PUBLISHED') {
      throw new NotFoundException(`No job posting found with id "${id}".`);
    }
    return toPublicDto(job);
  }
}

function toPublicDto(job: JobPostingWithSkills): PublicJobPostingDto {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
    experienceMin: job.experienceMin,
    salaryMax: job.salaryMax,
    deadline: job.deadline,
    location: job.location,
    seniority: job.seniority,
    workModel: job.workModel,
  };
}
