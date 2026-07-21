import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ASSIGNABLE_ROLES } from './create-user.dto';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: ASSIGNABLE_ROLES })
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: (typeof ASSIGNABLE_ROLES)[number];
}
