import type { ToolDefinition } from '../shared/llm/llm-client.types';

export interface AssistantToolDefinition extends ToolDefinition {
  /** True when this exact call must not execute until HR explicitly confirms (requirement 7). */
  isGated: (args: Record<string, unknown>) => boolean;
}

const never = () => false;

const searchCompanyPolicies: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'searchCompanyPolicies',
    description:
      "Search the company's policy and tech-stack documents (HR policy, benefits, culture, engineering stack) for relevant excerpts. Use this before drafting a job posting or answering a policy question.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
      },
      required: ['query'],
    },
  },
  isGated: never,
};

const createJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'createJobPosting',
    description:
      'Create a new job posting as a DRAFT. If `description` is omitted, one is drafted from company documents — always show HR the result and let them ask for changes before publishing.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        rawPrompt: {
          type: 'string',
          description: "HR's original request, verbatim.",
        },
        description: {
          type: 'string',
          description:
            'A fully-written description, if HR already provided one.',
        },
        requiredSkills: { type: 'array', items: { type: 'string' } },
        preferredSkills: { type: 'array', items: { type: 'string' } },
        experienceMin: {
          type: 'integer',
          description: 'Minimum years of experience required.',
        },
        salaryMax: { type: 'integer' },
        deadline: {
          type: 'string',
          description: 'ISO 8601 date, e.g. 2026-09-30.',
        },
        hiringTarget: {
          type: 'integer',
          description: 'Number of hires this posting targets.',
        },
        location: { type: 'string' },
        seniority: { type: 'string' },
        workModel: { type: 'string', enum: ['REMOTE', 'HYBRID', 'ONSITE'] },
      },
      required: [
        'title',
        'rawPrompt',
        'experienceMin',
        'deadline',
        'hiringTarget',
      ],
    },
  },
  isGated: never,
};

const updateJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'updateJobPosting',
    description:
      'Update fields on an existing job posting. Changing `status` (closing/archiving/re-drafting) always requires HR confirmation and will return a pendingAction instead of applying immediately.',
    parameters: {
      type: 'object',
      properties: {
        jobPostingId: { type: 'string' },
        changes: {
          type: 'object',
          description: 'Only the fields being changed.',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            requiredSkills: { type: 'array', items: { type: 'string' } },
            preferredSkills: { type: 'array', items: { type: 'string' } },
            experienceMin: { type: 'integer' },
            salaryMax: { type: 'integer' },
            deadline: { type: 'string' },
            hiringTarget: { type: 'integer' },
            location: { type: 'string' },
            seniority: { type: 'string' },
            workModel: {
              type: 'string',
              enum: ['REMOTE', 'HYBRID', 'ONSITE'],
            },
            status: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'ARCHIVED'],
            },
          },
        },
      },
      required: ['jobPostingId', 'changes'],
    },
  },
  isGated: (args) => {
    const changes = args.changes as Record<string, unknown> | undefined;
    return !!changes && 'status' in changes;
  },
};

const publishJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'publishJobPosting',
    description:
      'Publish a job posting, making it live. Always requires explicit HR confirmation.',
    parameters: {
      type: 'object',
      properties: { jobPostingId: { type: 'string' } },
      required: ['jobPostingId'],
    },
  },
  isGated: () => true,
};

const pauseJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'pauseJobPosting',
    description:
      'Temporarily hide a published job posting from the public jobs list without losing any candidate/application data. Only valid on a currently-published posting.',
    parameters: {
      type: 'object',
      properties: { jobPostingId: { type: 'string' } },
      required: ['jobPostingId'],
    },
  },
  isGated: never,
};

const resumeJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'resumeJobPosting',
    description:
      'Make a paused job posting public again. Only valid on a currently-paused posting.',
    parameters: {
      type: 'object',
      properties: { jobPostingId: { type: 'string' } },
      required: ['jobPostingId'],
    },
  },
  isGated: never,
};

const deleteJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'deleteJobPosting',
    description:
      'Permanently delete a job posting and everything tied to it — every application, interview session, transcript, match result, and email log against it. Cannot be undone. Always requires explicit HR confirmation.',
    parameters: {
      type: 'object',
      properties: { jobPostingId: { type: 'string' } },
      required: ['jobPostingId'],
    },
  },
  isGated: () => true,
};

const findJobPosting: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'findJobPosting',
    description:
      'Look up job postings by (partial, case-insensitive) title — use this to resolve a job the user referred to by name into its jobPostingId before calling any other job-posting tool, rather than guessing or reusing an ID from earlier in the conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full or partial job title to search for.' },
      },
      required: ['query'],
    },
  },
  isGated: never,
};

const assignHiringManager: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'assignHiringManager',
    description:
      "Assign a Hiring Manager (by their existing account email) to a job posting so it can be published — publishing fails until at least one is assigned. Only assigns an existing Hiring Manager account; it does not create a new user.",
    parameters: {
      type: 'object',
      properties: {
        jobPostingId: { type: 'string' },
        hiringManagerEmail: {
          type: 'string',
          description: "The Hiring Manager's account email address.",
        },
      },
      required: ['jobPostingId', 'hiringManagerEmail'],
    },
  },
  isGated: never,
};

const uploadCandidateCv: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'uploadCandidateCv',
    description:
      'Process a CV the HR user attached to this message against a job posting. Only call this when a file is actually attached — the file itself is taken from the HTTP request, not from your arguments.',
    parameters: {
      type: 'object',
      properties: { jobPostingId: { type: 'string' } },
      required: ['jobPostingId'],
    },
  },
  isGated: never,
};

const getCandidateProcessingStatus: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'getCandidateProcessingStatus',
    description:
      'Check whether an uploaded CV has finished background processing (PROCESSING | READY | FAILED).',
    parameters: {
      type: 'object',
      properties: { candidateId: { type: 'string' } },
      required: ['candidateId'],
    },
  },
  isGated: never,
};

const matchCandidateToJob: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'matchCandidateToJob',
    description:
      'Compute (and persist) an explainable match score for one candidate against one job posting. Requires the CV to be READY.',
    parameters: {
      type: 'object',
      properties: {
        candidateId: { type: 'string' },
        jobPostingId: { type: 'string' },
      },
      required: ['candidateId', 'jobPostingId'],
    },
  },
  isGated: never,
};

const rankCandidatesForJob: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'rankCandidatesForJob',
    description:
      'List already-matched candidates for a job posting, ranked by score, with optional filters.',
    parameters: {
      type: 'object',
      properties: {
        jobPostingId: { type: 'string' },
        minScore: { type: 'number' },
        recommendation: {
          type: 'string',
          enum: [
            'STRONG_MATCH',
            'POTENTIAL_MATCH',
            'NEEDS_REVIEW',
            'INSUFFICIENT_EVIDENCE',
          ],
        },
        limit: { type: 'integer' },
        rerank: {
          type: 'boolean',
          description:
            'Optional single LLM pass to reorder close ties. Never changes scores.',
        },
      },
      required: ['jobPostingId'],
    },
  },
  isGated: never,
};

const getCandidateMatchExplanation: AssistantToolDefinition = {
  type: 'function',
  function: {
    name: 'getCandidateMatchExplanation',
    description:
      'Get the full evidence/breakdown behind a candidate\'s latest match score for a job posting (e.g. "why did X score 78").',
    parameters: {
      type: 'object',
      properties: {
        candidateId: { type: 'string' },
        jobPostingId: { type: 'string' },
      },
      required: ['candidateId', 'jobPostingId'],
    },
  },
  isGated: never,
};

/** Every tool that exists — the source of truth for dispatch/gating lookups (findToolDefinition). Never send this whole list to the LLM in one call; use selectAssistantTools instead. */
export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  searchCompanyPolicies,
  createJobPosting,
  updateJobPosting,
  publishJobPosting,
  pauseJobPosting,
  resumeJobPosting,
  deleteJobPosting,
  findJobPosting,
  assignHiringManager,
  uploadCandidateCv,
  getCandidateProcessingStatus,
  matchCandidateToJob,
  rankCandidatesForJob,
  getCandidateMatchExplanation,
];

// ─── Responsibility groups ──────────────────────────────────────────────
// Sending all 14 schemas on every call wastes a large share of a small
// model's (and a tight Groq TPM budget's) tokens on tools that turn have
// nothing to do with the request, which is also what was driving
// tool_use_failed errors under load. Each group below is scoped to one
// responsibility and only sent when the conversation actually needs it —
// see selectAssistantTools.
export const POLICY_TOOLS: AssistantToolDefinition[] = [searchCompanyPolicies];

export const JOB_POSTING_TOOLS: AssistantToolDefinition[] = [
  findJobPosting,
  createJobPosting,
  updateJobPosting,
  publishJobPosting,
  pauseJobPosting,
  resumeJobPosting,
  deleteJobPosting,
  assignHiringManager,
  searchCompanyPolicies, // job drafting pulls tech-stack/benefits context (system prompt rule 2)
];

export const CANDIDATE_TOOLS: AssistantToolDefinition[] = [
  findJobPosting, // candidate tools are always scoped to a job posting by id
  uploadCandidateCv,
  getCandidateProcessingStatus,
  matchCandidateToJob,
  rankCandidatesForJob,
  getCandidateMatchExplanation,
];

interface ToolGroup {
  keywords: RegExp[];
  tools: AssistantToolDefinition[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    keywords: [
      /\bpolic(?:y|ies)\b/i,
      /\bbenefits?\b/i,
      /\bpto\b/i,
      /\bleave\b/i,
      /\bholidays?\b/i,
      /\bwfh\b/i,
      /work[- ]from[- ]home/i,
      /\btech[- ]stack\b/i,
      /\bculture\b/i,
    ],
    tools: POLICY_TOOLS,
  },
  {
    // Deliberately omits generic nouns like "role"/"position" — in this
    // domain they trigger on almost every sentence (including pure
    // candidate-ranking requests) without adding any real signal.
    keywords: [
      /\bjob\b/i,
      /\bposting\b/i,
      /\bvacan(?:cy|cies)\b/i,
      /\bpublish(?:ed|es|ing)?\b/i,
      /\bpause[ds]?\b/i,
      /\bresume[ds]?\b/i,
      /\barchiv(?:e|ed|es|ing)\b/i,
      /\bhiring manager\b/i,
      /\bdraft(?:ed|ing)?\b/i,
      /\brequisition\b/i,
      /\bclose[ds]?\b/i,
      /\bdelete[ds]?\b/i,
    ],
    tools: JOB_POSTING_TOOLS,
  },
  {
    // Deliberately omits bare "resume" — as a noun ("résumé") it's already
    // covered by "cv"/"candidate"/"upload", and as a verb it collides with
    // resumeJobPosting; letting the job-posting group own that word avoids
    // pulling in both groups for something like "resume the internship job".
    keywords: [
      /\bcv\b/i,
      /\bcandidates?\b/i,
      /\bapplicants?\b/i,
      /\bmatch(?:ing|ed|es)?\b/i,
      /\brank(?:ing|ed)?\b/i,
      /\bscores?\b/i,
      /\bshortlist(?:ed|ing)?\b/i,
      /\bupload(?:ed|ing)?\b/i,
    ],
    tools: CANDIDATE_TOOLS,
  },
];

/**
 * Picks the smallest tool set that plausibly covers the conversation instead
 * of always sending all 14 schemas. Matches on keywords across the full
 * context text (history + latest message) so a short follow-up like "yes,
 * resume it" still resolves against a role mentioned earlier. Falls back to
 * every tool only when nothing matches, so an unrecognized phrasing never
 * loses functionality — it just costs more tokens for that one call.
 */
export function selectAssistantTools(
  contextText: string,
): AssistantToolDefinition[] {
  const matchedGroups = TOOL_GROUPS.filter((group) =>
    group.keywords.some((keyword) => keyword.test(contextText)),
  );
  if (matchedGroups.length === 0) return ASSISTANT_TOOLS;

  const seen = new Set<string>();
  const tools: AssistantToolDefinition[] = [];
  for (const group of matchedGroups) {
    for (const tool of group.tools) {
      if (!seen.has(tool.function.name)) {
        seen.add(tool.function.name);
        tools.push(tool);
      }
    }
  }
  return tools;
}

export function findToolDefinition(
  name: string,
): AssistantToolDefinition | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.function.name === name);
}
