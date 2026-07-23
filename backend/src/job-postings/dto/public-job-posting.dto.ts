import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Candidate-facing view of a published job posting — excludes internal-only
 * fields (rawPrompt/generatedDescription/hiringTarget/hiredCount/
 * createdByUserId) and the internal `description` (see candidateSummary
 * instead, a short LLM-drafted narrative overview). Responsibilities and
 * required/preferred skills ARE shown here as part of the standardized
 * job-page format.
 */
export class PublicJobPostingDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() candidateSummary?: string | null;
  @ApiProperty({ type: [String] }) responsibilities!: string[];
  @ApiProperty({ type: [String] }) requiredSkills!: string[];
  @ApiProperty({ type: [String] }) preferredSkills!: string[];
  @ApiPropertyOptional() salaryMax?: number | null;
  @ApiProperty() deadline!: Date;
  @ApiPropertyOptional() location?: string | null;
  @ApiPropertyOptional() seniority?: string | null;
  @ApiPropertyOptional({ enum: ['REMOTE', 'HYBRID', 'ONSITE'] }) workModel?:
    string | null;
}
