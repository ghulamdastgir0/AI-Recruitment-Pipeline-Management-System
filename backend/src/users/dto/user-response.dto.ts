import { ApiProperty } from '@nestjs/swagger';

/** Never includes passwordHash. */
export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: ['SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER'] })
  role!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
}
