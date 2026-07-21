import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AssignHiringManagerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  hiringManagerUserId!: string;
}
