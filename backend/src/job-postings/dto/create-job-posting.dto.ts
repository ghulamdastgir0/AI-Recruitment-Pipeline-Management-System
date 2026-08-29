import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const WORK_MODELS = ['REMOTE', 'HYBRID', 'ONSITE'] as const;

// Shared caps so CreateJobPostingDto and UpdateJobPostingDto can't drift.
// Every one of these becomes stored text (and skill rows) — an uncapped
// value is a data-integrity / resource-abuse risk even though the endpoint
// is authenticated.
export const JOB_POSTING_LIMITS = {
  title: 200,
  rawPrompt: 5_000,
  description: 20_000,
  responsibilities: { max: 20, each: 500 },
  skills: { max: 50, each: 100 },
  location: 200,
  seniority: 100,
} as const;

export class CreateJobPostingDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(JOB_POSTING_LIMITS.title)
  title!: string;

  @ApiProperty({
    example: 'Create a job posting for a Senior Backend Engineer in Lahore.',
    description:
      "HR's original request, stored for audit and used to draft the description when none is supplied.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(JOB_POSTING_LIMITS.rawPrompt)
  rawPrompt!: string;

  @ApiPropertyOptional({
    description:
      'A fully-written description. If omitted, one is drafted from company policy/tech-stack documents.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.description)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Bullet-point responsibilities. If omitted while `description` is also omitted, drafted from company policy/tech-stack documents alongside the description.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOB_POSTING_LIMITS.responsibilities.max)
  @IsString({ each: true })
  @MaxLength(JOB_POSTING_LIMITS.responsibilities.each, { each: true })
  responsibilities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['NestJS', 'PostgreSQL'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOB_POSTING_LIMITS.skills.max)
  @IsString({ each: true })
  @MaxLength(JOB_POSTING_LIMITS.skills.each, { each: true })
  requiredSkills?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Redis'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(JOB_POSTING_LIMITS.skills.max)
  @IsString({ each: true })
  @MaxLength(JOB_POSTING_LIMITS.skills.each, { each: true })
  preferredSkills?: string[];

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  experienceMin!: number;

  @ApiPropertyOptional({ example: 250000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  salaryMax?: number;

  @ApiProperty({ example: '2026-09-30' })
  @IsISO8601()
  deadline!: string;

  @ApiProperty({
    example: 1,
    description: 'Number of hires this posting is targeting.',
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  hiringTarget!: number;

  @ApiPropertyOptional({ example: 'Lahore, Pakistan' })
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.location)
  location?: string;

  @ApiPropertyOptional({ example: 'Senior' })
  @IsOptional()
  @IsString()
  @MaxLength(JOB_POSTING_LIMITS.seniority)
  seniority?: string;

  @ApiPropertyOptional({ enum: WORK_MODELS })
  @IsOptional()
  @IsIn(WORK_MODELS)
  workModel?: (typeof WORK_MODELS)[number];
}
