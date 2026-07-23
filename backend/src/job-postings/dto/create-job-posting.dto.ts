import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

const WORK_MODELS = ['REMOTE', 'HYBRID', 'ONSITE'] as const;

export class CreateJobPostingDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    example: 'Create a job posting for a Senior Backend Engineer in Lahore.',
    description:
      "HR's original request, stored for audit and used to draft the description when none is supplied.",
  })
  @IsString()
  @IsNotEmpty()
  rawPrompt!: string;

  @ApiPropertyOptional({
    description:
      'A fully-written description. If omitted, one is drafted from company policy/tech-stack documents.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Bullet-point responsibilities. If omitted while `description` is also omitted, drafted from company policy/tech-stack documents alongside the description.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  responsibilities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['NestJS', 'PostgreSQL'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredSkills?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Redis'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
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
  location?: string;

  @ApiPropertyOptional({ example: 'Senior' })
  @IsOptional()
  @IsString()
  seniority?: string;

  @ApiPropertyOptional({ enum: WORK_MODELS })
  @IsOptional()
  @IsIn(WORK_MODELS)
  workModel?: (typeof WORK_MODELS)[number];
}
