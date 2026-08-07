import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: 'a-strong-new-password' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
