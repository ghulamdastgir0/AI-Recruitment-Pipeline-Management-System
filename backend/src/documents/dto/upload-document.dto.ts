import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @ApiProperty({
    example: 'Company Handbook',
    description: 'Stable display name grouping every version of this document.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
