export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <p className="p-6 text-sm text-gray-500">{label}</p>;
}

export function EmptyState({ label }: { label: string }) {
  return <p className="text-sm text-gray-500">{label}</p>;
}

export function ErrorState({ message }: { message: string }) {
  return <p className="p-6 text-sm text-red-600">{message}</p>;
}

export function PermissionDeniedState() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <p className="font-medium text-red-800">Permission denied</p>
      <p className="mt-1 text-sm text-red-700">
        You don&apos;t have access to this page. If you believe this is a
        mistake, contact your administrator.
      </p>
    </div>
  );
}
