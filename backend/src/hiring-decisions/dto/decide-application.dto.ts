import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, ValidateIf } from 'class-validator';

const DECISIONS = ['SELECTED', 'NEXT_ROUND', 'REJECTED'] as const;

export class DecideApplicationDto {
  @ApiProperty({ enum: DECISIONS })
  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  @ApiPropertyOptional({
    description: 'Required when decision is NEXT_ROUND.',
    example: '2026-08-05T14:00:00.000Z',
  })
  @ValidateIf((o: DecideApplicationDto) => o.decision === 'NEXT_ROUND')
  @IsISO8601()
  nextRoundTime?: string;

  @ApiPropertyOptional({
    description:
      'Required when decision is NEXT_ROUND — deadline for the candidate to respond/schedule.',
    example: '2026-08-08T23:59:00.000Z',
  })
  @ValidateIf((o: DecideApplicationDto) => o.decision === 'NEXT_ROUND')
  @IsISO8601()
  nextRoundDeadline?: string;
}
