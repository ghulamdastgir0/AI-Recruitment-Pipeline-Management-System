import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() originalFileName!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['PROCESSING', 'ACTIVE', 'INACTIVE', 'FAILED'] })
  status!: string;
  @ApiPropertyOptional() processingError?: string | null;
  @ApiProperty() uploadedAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
