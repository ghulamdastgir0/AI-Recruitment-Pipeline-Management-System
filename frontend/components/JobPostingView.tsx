const WORK_MODEL_LABELS: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

export interface JobPostingViewData {
  title: string;
  /** Job Description body — candidateSummary on the public page, description internally. */
  description: string;
  responsibilities: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  location?: string | null;
  workModel?: string | null;
}

function SkillChips({ skills }: { skills: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {skills.map((skill) => (
        <span
          key={skill}
          className="rounded-full bg-black/5 px-3 py-1 text-sm font-medium text-text-secondary"
        >
          {skill}
        </span>
      ))}
    </div>
  );
}

/**
 * Renders the standardized job-page format (Title, Employment Type,
 * Location, Job Description, Responsibilities, Required Skills, Preferred
 * Qualifications) shared by both the public apply page and the internal
 * HR/Admin job detail page, so the two surfaces can't drift apart.
 */
export function JobPostingView({ job }: { job: JobPostingViewData }) {
  const descriptionParagraphs = job.description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary md:text-3xl">
          {job.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {job.workModel && (
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              {WORK_MODEL_LABELS[job.workModel] ?? job.workModel}
            </span>
          )}
          {job.location && (
            <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-text-secondary">
              {job.location}
            </span>
          )}
        </div>
      </div>

      {descriptionParagraphs.length > 0 && (
        <section>
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Job Description
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {descriptionParagraphs.map((paragraph, index) => (
              <p key={index} className="whitespace-pre-wrap text-sm text-text-secondary">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      )}

      {job.responsibilities.length > 0 && (
        <section>
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Responsibilities
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
            {job.responsibilities.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {job.requiredSkills.length > 0 && (
        <section>
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Required Skills
          </h2>
          <div className="mt-3">
            <SkillChips skills={job.requiredSkills} />
          </div>
        </section>
      )}

      {job.preferredSkills.length > 0 && (
        <section>
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Preferred Qualifications
          </h2>
          <div className="mt-3">
            <SkillChips skills={job.preferredSkills} />
          </div>
        </section>
      )}
    </div>
  );
}
