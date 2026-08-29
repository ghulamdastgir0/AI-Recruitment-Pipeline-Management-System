import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AskAssistantDto {
  @ApiProperty({
    example: 'Create a job posting for a Senior Backend Engineer in Lahore.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8_000)
  message!: string;

  @ApiPropertyOptional({
    description:
      'JSON-encoded array of prior turns: [{ "role": "user"|"assistant", "content": "..." }]',
    example: '[]',
  })
  @IsOptional()
  @IsString()
  // The orchestrator only keeps the last few turns anyway (MAX_HISTORY_MESSAGES);
  // this just stops an unbounded blob from reaching the JSON parser.
  @MaxLength(200_000)
  history?: string;
}
