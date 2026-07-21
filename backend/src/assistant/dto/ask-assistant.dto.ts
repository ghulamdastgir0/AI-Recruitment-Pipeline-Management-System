import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AskAssistantDto {
  @ApiProperty({
    example: 'Create a job posting for a Senior Backend Engineer in Lahore.',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description:
      'JSON-encoded array of prior turns: [{ "role": "user"|"assistant", "content": "..." }]',
    example: '[]',
  })
  @IsOptional()
  @IsString()
  history?: string;
}
