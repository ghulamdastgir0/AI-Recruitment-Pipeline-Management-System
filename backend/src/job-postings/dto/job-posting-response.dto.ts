import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JobPostingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({
    enum: ['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'ARCHIVED'],
  })
  status!: string;
  @ApiProperty({ type: [String] }) responsibilities!: string[];
  @ApiProperty({ type: [String] }) requiredSkills!: string[];
  @ApiProperty({ type: [String] }) preferredSkills!: string[];
  @ApiProperty() experienceMin!: number;
  @ApiPropertyOptional() salaryMax?: number | null;
  @ApiProperty() deadline!: Date;
  @ApiProperty() hiringTarget!: number;
  @ApiProperty() hiredCount!: number;
  @ApiPropertyOptional() location?: string | null;
  @ApiPropertyOptional() seniority?: string | null;
  @ApiPropertyOptional({ enum: ['REMOTE', 'HYBRID', 'ONSITE'] }) workModel?:
    string | null;
  @ApiProperty() createdByUserId!: string;
  @ApiProperty() createdAt!: Date;
}
