"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { type Role, useAuth } from "@/lib/auth";
import { LoadingState } from "@/components/AsyncState";

/**
 * Gates a /staff/* page: redirects to /login until a session exists, and
 * (if `roles` is given) until the logged-in user's role is allowed.
 */
export function RoleGuard({
  roles,
  children,
}: {
  roles?: Role[];
  children: ReactNode;
}) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (roles && !roles.includes(user.role)) {
      router.replace("/staff");
    }
  }, [ready, user, roles, router]);

  if (!ready || !user || (roles && !roles.includes(user.role))) {
    return <LoadingState />;
  }

  return <>{children}</>;
}
