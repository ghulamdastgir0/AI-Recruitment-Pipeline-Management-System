import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LlmClientService } from '../../shared/llm/llm-client.service';
import {
  ExtractedCvProfileDto,
  stripProtectedCharacteristics,
} from '../dto/extracted-cv-profile.dto';

const CV_PARSER_SYSTEM_PROMPT = `You extract structured data from a candidate's CV/resume text for an ATS screening tool.

Return ONLY a JSON object with exactly these fields:
{
  "name": string | null,
  "email": string | null,
  "phone": string | null,
  "skills": string[],
  "experience": [{ "title": string, "company": string, "durationText": string, "description": string }],
  "projects": [{ "name": string, "description": string }],
  "education": [{ "institution": string, "degree": string, "field": string }],
  "certifications": string[],
  "experienceYears": number
}

Rules:
- experienceYears is your best estimate of total professional years from the experience entries.
- Never include age, date of birth, gender, religion, ethnicity, nationality, marital status, disability status,
  a photo/image reference, or a home address, even if present in the CV text. Omit them entirely — do not add
  fields for them under any name.
- If a field genuinely isn't present in the CV, use null (for strings) or an empty array (for lists) — never invent data.
- Output only the JSON object, no surrounding prose.`;

const MAX_PARSE_ATTEMPTS = 2;

@Injectable()
export class CvParserService {
  constructor(private readonly llm: LlmClientService) {}

  async parse(resumeText: string): Promise<ExtractedCvProfileDto> {
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      const result = await this.llm.chat(
        [
          { role: 'system', content: CV_PARSER_SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              attempt === 1
                ? `CV text:\n\n${resumeText}`
                : `CV text:\n\n${resumeText}\n\nYour previous output was invalid (${lastError}). Return only the corrected JSON object.`,
          },
        ],
        { jsonResponse: true },
      );

      try {
        const raw: unknown = JSON.parse(result.message.content ?? '{}');
        const sanitized = stripProtectedCharacteristics(raw);
        const normalized = normalizeShape(sanitized);
        const dto = plainToInstance(ExtractedCvProfileDto, normalized);
        const errors = await validate(dto, { whitelist: true });
        if (errors.length === 0) {
          return dto;
        }
        lastError = errors
          .map((e) => Object.values(e.constraints ?? {}).join('; '))
          .join('; ');
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(
      `CV parsing produced invalid structured data after ${MAX_PARSE_ATTEMPTS} attempts: ${lastError}`,
    );
  }
}

/** Fills in the array/number defaults the LLM sometimes omits so validation failures are about real data problems, not shape noise. */
function normalizeShape(value: unknown): Record<string, unknown> {
  const obj = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    ...obj,
    skills: Array.isArray(obj.skills) ? obj.skills : [],
    experience: Array.isArray(obj.experience) ? obj.experience : [],
    projects: Array.isArray(obj.projects) ? obj.projects : [],
    education: Array.isArray(obj.education) ? obj.education : [],
    certifications: Array.isArray(obj.certifications) ? obj.certifications : [],
    experienceYears:
      typeof obj.experienceYears === 'number' ? obj.experienceYears : 0,
  };
}
