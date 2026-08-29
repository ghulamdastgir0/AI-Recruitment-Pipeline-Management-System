import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JOB_POSTING_LIMITS } from './create-job-posting.dto';

const WORK_MODELS = ['REMOTE', 'HYBRID', 'ONSITE'] as const;
const JOB_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'PAUSED',
  'CLOSED',
  'ARCHIVED',
] as const;

export class UpdateJobPostingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.title)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.description)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOB_POSTING_LIMITS.responsibilities.max)
  @IsString({ each: true })
  @MaxLength(JOB_POSTING_LIMITS.responsibilities.each, { each: true })
  responsibilities?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOB_POSTING_LIMITS.skills.max)
  @IsString({ each: true })
  @MaxLength(JOB_POSTING_LIMITS.skills.each, { each: true })
  requiredSkills?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOB_POSTING_LIMITS.skills.max)
  @IsString({ each: true })
  @MaxLength(JOB_POSTING_LIMITS.skills.each, { each: true })
  preferredSkills?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  experienceMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  salaryMax?: number;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() deadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  hiringTarget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.location)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.seniority)
  seniority?: string;

  @ApiPropertyOptional({ enum: WORK_MODELS })
  @IsOptional()
  @IsIn(WORK_MODELS)
  workModel?: (typeof WORK_MODELS)[number];

  @ApiPropertyOptional({
    enum: JOB_STATUSES,
    description:
      'Changing this always requires HR confirmation via the assistant’s confirm-action flow.',
  })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];
}
