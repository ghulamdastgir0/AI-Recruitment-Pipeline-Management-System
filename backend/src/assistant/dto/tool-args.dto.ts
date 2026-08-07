import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class SearchPoliciesArgsDto {
  @IsString()
  @IsNotEmpty()
  query!: string;
}

export class JobPostingIdArgsDto {
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;
}

export class FindJobPostingArgsDto {
  @IsString()
  @IsNotEmpty()
  query!: string;
}

export class AssignHiringManagerArgsDto {
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @IsString()
  @IsNotEmpty()
  hiringManagerEmail!: string;
}

export class UpdateJobPostingArgsDto {
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;
}

export class UploadCandidateCvArgsDto {
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;
}

export class CandidateIdArgsDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;
}

export class CandidateJobArgsDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;
}

export class RankCandidatesArgsDto {
  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minScore?: number;

  @IsOptional()
  @IsIn([
    'STRONG_MATCH',
    'POTENTIAL_MATCH',
    'NEEDS_REVIEW',
    'INSUFFICIENT_EVIDENCE',
  ])
  recommendation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  rerank?: boolean;
}

export class AddCandidateCommentArgsDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class MarkManagerReviewedArgsDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @IsString()
  @IsNotEmpty()
  comment!: string;
}

const DECISIONS = ['SELECTED', 'NEXT_ROUND', 'REJECTED'] as const;

export class DecideApplicationArgsDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  @ValidateIf((o: DecideApplicationArgsDto) => o.decision === 'NEXT_ROUND')
  @IsISO8601()
  nextRoundTime?: string;

  @ValidateIf((o: DecideApplicationArgsDto) => o.decision === 'NEXT_ROUND')
  @IsISO8601()
  nextRoundDeadline?: string;
}

export class SendOfferLetterArgsDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  jobPostingId!: string;

  @IsOptional()
  @IsString()
  offerDetails?: string;
}
