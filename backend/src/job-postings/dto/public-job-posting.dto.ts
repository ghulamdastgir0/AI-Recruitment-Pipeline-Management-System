import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Slim, candidate-facing view of a published job posting — deliberately
 * excludes internal-only fields present on JobPostingResponseDto
 * (rawPrompt/generatedDescription/hiringTarget/hiredCount/createdByUserId).
 */
export class PublicJobPostingDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [String] }) requiredSkills!: string[];
  @ApiProperty({ type: [String] }) preferredSkills!: string[];
  @ApiProperty() experienceMin!: number;
  @ApiPropertyOptional() salaryMax?: number | null;
  @ApiProperty() deadline!: Date;
  @ApiPropertyOptional() location?: string | null;
  @ApiPropertyOptional() seniority?: string | null;
  @ApiPropertyOptional({ enum: ['REMOTE', 'HYBRID', 'ONSITE'] }) workModel?:
    string | null;
}
