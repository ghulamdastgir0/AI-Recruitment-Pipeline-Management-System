"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function StaffNav() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const canUseAssistant = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-3">
      <div className="flex items-center gap-4">
        <Link href="/staff" className="text-sm font-semibold text-gray-900">
          Job Postings
        </Link>
        {canUseAssistant && (
          <Link
            href="/staff/assistant"
            className="text-sm text-blue-600 hover:underline"
          >
            Assistant
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">
          {user.email} ({user.role})
        </span>
        <button onClick={logout} className="text-sm text-blue-600 underline">
          Sign out
        </button>
      </div>
    </nav>
  );
}
