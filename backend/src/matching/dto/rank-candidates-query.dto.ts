import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class RankCandidatesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minScore?: number;

  @ApiPropertyOptional({
    enum: [
      'STRONG_MATCH',
      'POTENTIAL_MATCH',
      'NEEDS_REVIEW',
      'INSUFFICIENT_EVIDENCE',
    ],
  })
  @IsOptional()
  @IsIn([
    'STRONG_MATCH',
    'POTENTIAL_MATCH',
    'NEEDS_REVIEW',
    'INSUFFICIENT_EVIDENCE',
  ])
  recommendation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
