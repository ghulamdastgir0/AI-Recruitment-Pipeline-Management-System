import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UploadCvDto {
  @ApiProperty({
    description: 'Id of the job posting this CV is being submitted for.',
  })
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;
}
