"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiFetch, postJson } from "./api";

export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "HIRING_MANAGER";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

interface LoginResponse {
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the initial session check (GET /profile) has resolved. */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Merges a patch (e.g. an edited name) into the cached session user — keeps the nav's avatar/email in sync after a profile edit without a full re-login. */
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The session lives in an httpOnly cookie (inaccessible to page JS by
    // design), so the only way to know if one exists on load/refresh is to
    // ask the backend — it rides along automatically via credentials:
    // "include" in apiFetch.
    /* eslint-disable react-hooks/set-state-in-effect */
    apiFetch<AuthUser>("/profile")
      .then((profile) => setUser(profile))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function login(email: string, password: string) {
    const result = await postJson<LoginResponse>("/auth/login", {
      email,
      password,
    });
    setUser(result.user);
  }

  async function logout() {
    try {
      await postJson("/auth/logout", {});
    } catch (err) {
      // Cookie may already be gone/expired — still clear local state below.
      if (!(err instanceof ApiError)) throw err;
    }
    setUser(null);
  }

  function updateUser(patch: Partial<AuthUser>) {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
