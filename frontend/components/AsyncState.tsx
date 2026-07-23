export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-text-muted">
      <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center text-sm text-text-muted">
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">
      {message}
    </div>
  );
}

export function PermissionDeniedState() {
  return (
    <div className="rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft p-6">
      <p className="font-medium text-danger-text">Permission denied</p>
      <p className="mt-1 text-sm text-danger-text">
        You don&apos;t have access to this page. If you believe this is a
        mistake, contact your administrator.
      </p>
    </div>
  );
}
