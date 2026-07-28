import { MAX_INTERVIEW_WARNINGS } from "@/lib/monitoring/violationTypes";

export function MonitoringStatusBadge({ warningTotal }: { warningTotal: number }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
      <span>Monitoring Active</span>
      <span className="text-white/50">·</span>
      <span className={warningTotal > 0 ? "text-amber-300" : "text-white/70"}>
        Warnings: {warningTotal}/{MAX_INTERVIEW_WARNINGS}
      </span>
    </div>
  );
}
