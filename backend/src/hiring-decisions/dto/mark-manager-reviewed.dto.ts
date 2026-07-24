import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MarkManagerReviewedDto {
  @ApiProperty({ example: 'Strong system-design answers in the panel.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  comment!: string;
}
