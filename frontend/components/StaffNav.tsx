"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  BriefcaseIcon,
  CloseIcon,
  DocumentsIcon,
  LogoutIcon,
  MenuIcon,
  UserIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { useAuth } from "@/lib/auth";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  HIRING_MANAGER: "Hiring Manager",
};

function NavItem({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`relative flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-50 text-brand-700"
          : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
      }`}
    >
      {active && (
        <span className="absolute -left-3 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-brand-600" />
      )}
      <span className="h-4 w-4 shrink-0">{icon}</span>
      {children}
    </Link>
  );
}

/**
 * Sidebar shell wrapping every /staff/* page: fixed left nav + a scrollable
 * content column with its own header (page title, theme toggle, page
 * actions). HR_ADMIN and HIRING_MANAGER share this same shell — only the nav
 * items and page content differ by role/permission.
 */
export function StaffNav({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Route changes (clicking a nav link) should close the off-canvas drawer
  // on narrow viewports instead of leaving it open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (!user) return null;

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const roleLabel = ROLE_LABELS[user.role] ?? user.role.replaceAll("_", " ");

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-card transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2.5 px-5 py-5">
          <Link href="/staff" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
              AI
            </span>
            <span className="leading-tight">
              <span className="block font-heading text-sm font-semibold text-text-primary">
                Recruitment Pipeline
              </span>
              <span className="block text-xs text-text-muted">Staff Console</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="rounded-[var(--radius-control)] p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary lg:hidden"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-2 flex flex-1 flex-col gap-1 px-6">
          <NavItem
            href="/staff"
            active={pathname === "/staff" || pathname.startsWith("/staff/jobs")}
            icon={<BriefcaseIcon className="h-full w-full" />}
          >
            Job Postings
          </NavItem>
          <NavItem
            href="/staff/profile"
            active={pathname === "/staff/profile"}
            icon={<UserIcon className="h-full w-full" />}
          >
            Profile
          </NavItem>
          {isSuperAdmin && (
            <>
              <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Admin
              </p>
              <NavItem
                href="/staff/admin/users"
                active={pathname === "/staff/admin/users"}
                icon={<UsersIcon className="h-full w-full" />}
              >
                Users
              </NavItem>
              <NavItem
                href="/staff/admin/documents"
                active={pathname === "/staff/admin/documents"}
                icon={<DocumentsIcon className="h-full w-full" />}
              >
                Documents
              </NavItem>
            </>
          )}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 p-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
              {initials || "?"}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-text-primary">
                {user.firstName} {user.lastName}
              </span>
              <span className="block truncate text-xs text-text-muted">{roleLabel}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary"
          >
            <LogoutIcon className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-card px-6 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="rounded-[var(--radius-control)] p-1.5 text-text-secondary hover:bg-surface-muted hover:text-text-primary lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <h1 className="truncate font-heading text-xl font-semibold text-text-primary sm:text-2xl">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {actions}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <AssistantWidget />
    </div>
  );
}
