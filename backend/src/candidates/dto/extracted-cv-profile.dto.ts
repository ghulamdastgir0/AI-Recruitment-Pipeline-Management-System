import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExtractedExperienceEntryDto {
  @IsString() title!: string;
  @IsString() company!: string;
  @IsOptional() @IsString() durationText?: string;
  @IsOptional() @IsString() description?: string;
}

export class ExtractedEducationEntryDto {
  @IsString() institution!: string;
  @IsOptional() @IsString() degree?: string;
  @IsOptional() @IsString() field?: string;
}

export class ExtractedProjectEntryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
}

/**
 * Structured CV data the parser prompt is instructed to produce. Deliberately
 * excludes anything that could act as a protected-characteristic proxy
 * (age, DOB, gender, religion, ethnicity, nationality, marital status,
 * disability, photo, address) — matching only reads these fields.
 */
export class ExtractedCvProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;

  @IsArray()
  @IsString({ each: true })
  skills!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedExperienceEntryDto)
  experience!: ExtractedExperienceEntryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedProjectEntryDto)
  projects!: ExtractedProjectEntryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedEducationEntryDto)
  education!: ExtractedEducationEntryDto[];

  @IsArray()
  @IsString({ each: true })
  certifications!: string[];

  @IsInt()
  @Min(0)
  experienceYears!: number;
}

// Defense in depth: strip these keys wherever they appear in the raw LLM
// JSON output before it's even handed to class-validator, in case the model
// ignores the prompt's exclusion instruction.
const PROTECTED_CHARACTERISTIC_KEYS = new Set([
  'age',
  'dateofbirth',
  'dob',
  'birthdate',
  'gender',
  'sex',
  'religion',
  'ethnicity',
  'race',
  'nationality',
  'maritalstatus',
  'disability',
  'photo',
  'image',
  'picture',
  'address',
  'homeaddress',
]);

export function stripProtectedCharacteristics(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripProtectedCharacteristics);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (PROTECTED_CHARACTERISTIC_KEYS.has(key.toLowerCase())) continue;
      result[key] = stripProtectedCharacteristics(val);
    }
    return result;
  }
  return value;
}
