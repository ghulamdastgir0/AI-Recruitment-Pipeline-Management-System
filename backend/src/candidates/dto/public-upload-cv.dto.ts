import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Stricter than UploadCvDto — used only by the public self-apply endpoint,
 * where the candidate types their own contact details directly instead of
 * relying solely on LLM extraction from the CV (which has previously
 * hallucinated wrong names/emails in this codebase). UploadCvDto stays as-is
 * for the HR-sourced assistant-tool upload path, where these fields aren't
 * always known upfront.
 */
export class PublicUploadCvDto {
  @ApiProperty({
    description: 'Id of the job posting this CV is being submitted for.',
  })
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @ApiProperty({ description: 'Your full name.' })
  @IsString()
  @IsNotEmpty()
  candidateName!: string;

  @ApiProperty({ description: 'Your email address.' })
  @IsEmail()
  candidateEmail!: string;

  @ApiProperty({ description: 'Your phone number.' })
  @IsString()
  @IsNotEmpty()
  candidatePhone!: string;
}
