import type { ToolDefinition } from '../shared/llm/llm-client.types';

export interface AssistantToolDefinition extends ToolDefinition {
  /** True when this exact call must not execute until HR explicitly confirms (requirement 7). */
  isGated: (args: Record<string, unknown>) => boolean;
}

const never = () => false;

export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
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
  },
  {
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
  },
  {
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
                enum: ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'],
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

export function findToolDefinition(
  name: string,
): AssistantToolDefinition | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.function.name === name);
}
