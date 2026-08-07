import { InternalStatusBadge } from "@/components/StatusBadge";

export interface JobPostingSummary {
  id: string;
  title: string;
  status: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  experienceMin: number;
  salaryMax: number | null;
  deadline: string;
  hiringTarget: number;
  location: string | null;
  seniority: string | null;
  workModel: string | null;
}

function SkillTags({ label, skills }: { label: string; skills: string[] }) {
  if (skills.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <span
            key={skill}
            className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs text-text-secondary"
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Structured preview of a job posting the assistant just created/updated —
 * same title/status-badge/location line as the staff dashboard's job cards
 * (see app/staff/page.tsx), so a drafted job looks the same whether it's
 * shown in chat or in the jobs list. Renders the real fields the backend
 * returned rather than the LLM's own paraphrase of them, which was
 * inconsistent in structure and easy to misread.
 */
export function JobPostingCard({ job }: { job: JobPostingSummary }) {
  const deadline = new Date(job.deadline);
  const deadlineLabel = Number.isNaN(deadline.getTime())
    ? "Not set"
    : deadline.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

  return (
    <div className="rounded-xl border border-border bg-surface-card p-3.5 text-text-primary">
      <div className="flex items-center justify-between gap-3">
        <p className="font-heading text-base font-semibold">{job.title}</p>
        <InternalStatusBadge status={job.status} />
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {[job.location, job.seniority, job.workModel].filter(Boolean).join(" · ") ||
          "No location specified"}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-text-secondary">
        <div>
          <span className="text-text-muted">Experience: </span>
          {job.experienceMin}+ yrs
        </div>
        <div>
          <span className="text-text-muted">Hiring target: </span>
          {job.hiringTarget}
        </div>
        <div>
          <span className="text-text-muted">Deadline: </span>
          {deadlineLabel}
        </div>
        <div>
          <span className="text-text-muted">Salary cap: </span>
          {job.salaryMax != null ? job.salaryMax.toLocaleString() : "Not specified"}
        </div>
      </div>

      {job.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">
          {job.description}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <SkillTags label="Required skills" skills={job.requiredSkills} />
        <SkillTags label="Preferred skills" skills={job.preferredSkills} />
      </div>
    </div>
  );
}
