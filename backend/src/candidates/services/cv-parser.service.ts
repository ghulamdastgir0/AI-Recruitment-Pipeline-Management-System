import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LlmClientService } from '../../shared/llm/llm-client.service';
import {
  ExtractedCvProfileDto,
  stripProtectedCharacteristics,
} from '../dto/extracted-cv-profile.dto';

/**
 * The shared default chat model (originally llama-3.3-70b-versatile, now
 * openai/gpt-oss-120b after Groq's Aug 2026 decommission) was found to
 * confabulate entire fictional resumes for this task instead of grounding on
 * the given CV text — wrong name/email/employers, unrelated to the actual
 * input — which also produces malformed JSON (prose prepended before the
 * object) and fails Groq's json_object validator. gpt-oss-20b was verified
 * (manually, against a real CV that reproduced the failure) to extract
 * accurately and reliably. Scoped to this parser only, not the shared
 * default, since other callers (assistant tool-calling, rerank) haven't
 * shown this problem and swapping the global default is a bigger change.
 */
const DEFAULT_CV_PARSER_MODEL = 'openai/gpt-oss-20b';

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

const MAX_PARSE_ATTEMPTS = 3;

@Injectable()
export class CvParserService {
  constructor(
    private readonly llm: LlmClientService,
    private readonly config: ConfigService,
  ) {}

  async parse(resumeText: string): Promise<ExtractedCvProfileDto> {
    const model =
      this.config.get<string>('GROQ_CV_PARSER_MODEL') ??
      DEFAULT_CV_PARSER_MODEL;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        // The LLM call itself belongs inside this try, not just the parsing
        // below it — Groq's JSON mode hard-validates server-side and throws
        // a 400 (json_validate_failed) instead of returning malformed
        // content when the model doesn't produce valid JSON. That failure
        // needs to feed the same retry-with-correction loop as our own
        // parse/validation errors, or attempt 1 permanently fails the CV
        // the moment the model produces one bad completion.
        const result = await this.llm.chat(
          [
            { role: 'system', content: CV_PARSER_SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                attempt === 1
                  ? `CV text:\n\n${resumeText}`
                  : `CV text:\n\n${resumeText}\n\nYour previous output was invalid (${lastError}). Return ONLY a single valid JSON object matching the schema — no prose, no markdown, no trailing commentary.`,
            },
          ],
          { jsonResponse: true, model },
        );

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
        lastError = summarizeParseFailure(error);
      }
    }

    throw new Error(
      `CV parsing produced invalid structured data after ${MAX_PARSE_ATTEMPTS} attempts: ${lastError}`,
    );
  }
}

/**
 * Groq's json_validate_failed errors embed the model's entire malformed
 * output (often a full CV-shaped wall of text) in `failed_generation`.
 * Echoing that verbatim into the next retry prompt just hands the model
 * another CV-like blob to "correct" instead of a clear signal to fix its
 * output shape, which tends to reproduce the same non-JSON response again.
 * Collapse it to a short, generic instruction instead.
 */
function summarizeParseFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('json_validate_failed')) {
    return 'the response was not a valid JSON object';
  }
  return message.slice(0, 300);
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
