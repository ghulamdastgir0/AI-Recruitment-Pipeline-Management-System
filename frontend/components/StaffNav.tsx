"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-50 text-brand-700"
          : "text-text-secondary hover:bg-black/5 hover:text-text-primary"
      }`}
    >
      {children}
    </Link>
  );
}

export function StaffNav() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  const canUseAssistant = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-card px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/staff" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            AI
          </span>
          <span className="font-heading text-sm font-semibold text-text-primary">
            Recruitment Pipeline
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <NavLink href="/staff" active={pathname === "/staff" || pathname.startsWith("/staff/jobs")}>
            Job Postings
          </NavLink>
          {canUseAssistant && (
            <NavLink href="/staff/assistant" active={pathname === "/staff/assistant"}>
              Assistant
            </NavLink>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials || "?"}
          </span>
          <span className="hidden text-sm text-text-secondary sm:inline">
            {user.email} · {user.role.replaceAll("_", " ")}
          </span>
        </div>
        <button
          onClick={logout}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-black/5"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
