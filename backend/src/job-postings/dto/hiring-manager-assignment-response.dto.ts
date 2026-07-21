import { ApiProperty } from '@nestjs/swagger';

export class HiringManagerAssignmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() jobId!: string;
  @ApiProperty() hiringManagerUserId!: string;
  @ApiProperty() assignedByUserId!: string;
  @ApiProperty() assignedAt!: Date;
}
