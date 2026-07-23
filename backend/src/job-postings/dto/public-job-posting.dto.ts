import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Slim, candidate-facing view of a published job posting — deliberately
 * excludes internal-only fields (rawPrompt/generatedDescription/
 * hiringTarget/hiredCount/createdByUserId) AND the internal `description`/
 * requiredSkills/preferredSkills (ATS scoring criteria, not for candidates —
 * see candidateSummary instead, a short LLM-drafted candidate-safe blurb).
 */
export class PublicJobPostingDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() candidateSummary?: string | null;
  @ApiPropertyOptional() salaryMax?: number | null;
  @ApiProperty() deadline!: Date;
  @ApiPropertyOptional() location?: string | null;
  @ApiPropertyOptional() seniority?: string | null;
  @ApiPropertyOptional({ enum: ['REMOTE', 'HYBRID', 'ONSITE'] }) workModel?:
    string | null;
}
