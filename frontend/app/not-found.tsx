import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <p className="font-heading text-5xl font-semibold text-brand-600">404</p>
      <h1 className="font-heading text-xl font-semibold text-text-primary">
        This page could not be found
      </h1>
      <p className="max-w-sm text-sm text-text-muted">
        The link may be broken, or the page may have been moved.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-[var(--radius-control)] bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        Back to home
      </Link>
    </main>
  );
}
