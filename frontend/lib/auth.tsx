"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { postJson } from "./api";

export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "HIRING_MANAGER";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  /** True until the stored session has been read from localStorage. */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Merges a patch (e.g. an edited name) into the cached session user — keeps the nav's avatar/email in sync after a profile edit without a full re-login. */
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Hydrating from localStorage (a browser-only API unavailable during SSR)
    // has to happen in an effect — there's no render-time alternative here.
    /* eslint-disable react-hooks/set-state-in-effect */
    const storedToken = window.localStorage.getItem("token");
    const storedUser = window.localStorage.getItem("user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser) as AuthUser);
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function login(email: string, password: string) {
    const result = await postJson<LoginResponse>("/auth/login", {
      email,
      password,
    });
    window.localStorage.setItem("token", result.accessToken);
    window.localStorage.setItem("user", JSON.stringify(result.user));
    setToken(result.accessToken);
    setUser(result.user);
  }

  function logout() {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }

  function updateUser(patch: Partial<AuthUser>) {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      window.localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{ token, user, ready, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
