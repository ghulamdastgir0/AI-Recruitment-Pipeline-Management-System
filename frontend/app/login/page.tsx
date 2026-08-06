"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/staff");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-900 via-brand-700 to-accent-violet p-12 text-white md:flex">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-bold">
            AI
          </span>
          <span className="font-heading text-lg font-semibold">
            Recruitment Pipeline
          </span>
        </div>
        <div>
          <p className="font-heading text-3xl font-semibold text-balance">
            Screen faster. Interview smarter. Hire with confidence.
          </p>
          <p className="mt-3 max-w-sm text-sm text-white/80">
            AI-assisted screening, structured voice interviews, and a
            transparent pipeline — built for your recruiting team.
          </p>
        </div>
        <p className="text-xs text-white/60">
          © {new Date().getFullYear()} AI Recruitment Pipeline
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Sign in to your workspace
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            For HR, Admin, and Hiring Manager accounts only. Candidates apply
            without an account.
          </p>
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                required
                maxLength={72}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
