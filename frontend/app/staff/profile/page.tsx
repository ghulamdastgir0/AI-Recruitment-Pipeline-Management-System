"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { apiFetch, ApiError, patchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  HIRING_MANAGER: "Hiring Manager",
};

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

function ProfileDetailsForm({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (updated: Profile) => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await patchJson<Profile>("/profile", { firstName, lastName });
      onSaved(updated);
      showToast("Profile updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="font-heading text-base font-semibold text-text-primary">
        Your details
      </h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-first-name">First name</Label>
            <Input
              id="profile-first-name"
              required
              maxLength={40}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-last-name">Last name</Label>
            <Input
              id="profile-last-name"
              required
              maxLength={40}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={profile.email} disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-role">Role</Label>
            <Input
              id="profile-role"
              value={ROLE_LABELS[profile.role] ?? profile.role}
              disabled
            />
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Member since{" "}
          {new Date(profile.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          . Email and role can only be changed by a Super Admin from the Users
          page.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          type="submit"
          disabled={saving || (firstName === profile.firstName && lastName === profile.lastName)}
          className="self-start"
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Card>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setSubmitting(true);
    setError(null);
    try {
      await patchJson("/profile/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password changed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="font-heading text-base font-semibold text-text-primary">
        Change password
      </h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            required
            maxLength={72}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              required
              maxLength={72}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {mismatch && (
              <p className="text-xs text-danger">Passwords don&apos;t match.</p>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          type="submit"
          disabled={submitting || mismatch || !currentPassword || !newPassword}
          className="self-start"
        >
          {submitting ? "Changing…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}

function ProfilePage() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Profile>("/profile")
      .then(setProfile)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load profile."),
      );
  }, []);

  return (
    <StaffNav title="My Profile">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-sm text-text-muted">
          Manage your own account details and password.
        </p>

        {error && (
          <div className="mt-6">
            <ErrorState message={error} />
          </div>
        )}
        {!profile && !error && (
          <div className="mt-6">
            <LoadingState />
          </div>
        )}

        {profile && (
          <div className="mt-6">
            <ProfileDetailsForm
              profile={profile}
              onSaved={(updated) => {
                setProfile(updated);
                updateUser({
                  firstName: updated.firstName,
                  lastName: updated.lastName,
                });
              }}
            />
            <ChangePasswordForm />
          </div>
        )}
      </div>
    </StaffNav>
  );
}

export default function StaffProfilePage() {
  return (
    <RoleGuard>
      <ProfilePage />
    </RoleGuard>
  );
}
