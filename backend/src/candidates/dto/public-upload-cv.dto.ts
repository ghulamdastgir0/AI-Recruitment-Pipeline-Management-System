import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Stricter than UploadCvDto — used only by the public self-apply endpoint,
 * where the candidate types their own contact details directly instead of
 * relying solely on LLM extraction from the CV (which has previously
 * hallucinated wrong names/emails in this codebase). UploadCvDto stays as-is
 * for the HR-sourced assistant-tool upload path, where these fields aren't
 * always known upfront.
 *
 * Every free-text field is length-capped: this endpoint is unauthenticated,
 * so an uncapped string is stored straight to the DB (and later rendered in
 * the staff console / interpolated into email).
 */
export class PublicUploadCvDto {
  @ApiProperty({
    description: 'Id of the job posting this CV is being submitted for.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  jobPostingId!: string;

  @ApiProperty({ description: 'Your full name.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  candidateName!: string;

  @ApiProperty({ description: 'Your email address.' })
  @IsEmail()
  @MaxLength(254)
  candidateEmail!: string;

  @ApiProperty({ description: 'Your phone number.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  candidatePhone!: string;
}
