import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
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
