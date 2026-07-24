import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SendOfferLetterDto {
  @ApiPropertyOptional({
    description:
      'Optional free text to include in the offer email (start date, compensation, next steps).',
  })
  @IsOptional()
  @IsString()
  offerDetails?: string;
}
