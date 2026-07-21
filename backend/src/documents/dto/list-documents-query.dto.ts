import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter to versions of a single document name.',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ['PROCESSING', 'ACTIVE', 'INACTIVE', 'FAILED'] })
  @IsOptional()
  @IsIn(['PROCESSING', 'ACTIVE', 'INACTIVE', 'FAILED'])
  status?: 'PROCESSING' | 'ACTIVE' | 'INACTIVE' | 'FAILED';
}
