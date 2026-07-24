"use client";

import { type FormEvent, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import {
  apiFetch,
  ApiError,
  deleteRequest,
  patchJson,
  postJson,
} from "@/lib/api";

type AssignableRole = "HR_ADMIN" | "HIRING_MANAGER";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "SUPER_ADMIN" | AssignableRole;
  isActive: boolean;
  createdAt: string;
}

const ROLE_SELECT_CLASSES =
  "rounded-[var(--radius-control)] border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

function RoleSelect({
  value,
  onChange,
  id,
}: {
  value: AssignableRole;
  onChange: (role: AssignableRole) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as AssignableRole)}
      className={`${ROLE_SELECT_CLASSES} sm:w-64`}
    >
      <option value="HR_ADMIN">HR Admin</option>
      <option value="HIRING_MANAGER">Hiring Manager</option>
    </select>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<AssignableRole>("HR_ADMIN");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await postJson("/admin/users", { email, password, firstName, lastName, role });
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      setRole("HR_ADMIN");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-first-name">First name</Label>
            <Input
              id="new-first-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-last-name">Last name</Label>
            <Input
              id="new-last-name"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">Temporary password</Label>
            <Input
              id="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-role">Role</Label>
          <RoleSelect id="new-role" value={role} onChange={setRole} />
        </div>
        <p className="text-xs text-text-muted">
          Credentials must be shared with the new user out of band — no invite
          email is sent by this system.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Creating…" : "Create User"}
        </Button>
      </form>
    </Card>
  );
}

function EditUserForm({
  user,
  onSaved,
  onCancel,
}: {
  user: User;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [role, setRole] = useState<AssignableRole>(user.role as AssignableRole);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patchJson(`/admin/users/${user.id}`, { firstName, lastName, role });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-3 border-t border-border pt-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
        />
        <Input
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
        />
      </div>
      <RoleSelect value={role} onChange={setRole} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function UsersAdmin() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function loadUsers() {
    apiFetch<User[]>("/admin/users")
      .then(setUsers)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load users."),
      );
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function toggleStatus(user: User) {
    setBusyId(user.id);
    setError(null);
    try {
      await patchJson(`/admin/users/${user.id}/status`, {
        isActive: !user.isActive,
      });
      loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(user: User) {
    if (
      !window.confirm(
        `Remove ${user.firstName} ${user.lastName} (${user.email})? This deactivates their account — it does not delete their history.`,
      )
    ) {
      return;
    }
    setBusyId(user.id);
    setError(null);
    try {
      await deleteRequest(`/admin/users/${user.id}`);
      loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove user.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Users
          </h1>
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "New User"}
          </Button>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Add, edit, deactivate, or remove HR Admin and Hiring Manager
          accounts.
        </p>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} />
          </div>
        )}

        {showCreate && (
          <CreateUserForm
            onCreated={() => {
              setShowCreate(false);
              loadUsers();
            }}
          />
        )}

        {users === null && !error && (
          <div className="mt-6">
            <LoadingState />
          </div>
        )}
        {users?.length === 0 && (
          <div className="mt-6">
            <EmptyState label="No users yet." />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {users?.map((u) => {
            const isSuperAdmin = u.role === "SUPER_ADMIN";
            return (
              <Card key={u.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-sm text-text-muted">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-text-secondary">
                      {u.role.replaceAll("_", " ")}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        u.isActive
                          ? "bg-success-soft text-success-text"
                          : "bg-black/5 text-text-muted"
                      }`}
                    >
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>

                {isSuperAdmin ? (
                  <p className="mt-2 text-xs text-text-muted">
                    Super Admin accounts can&apos;t be edited or deactivated
                    here.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      onClick={() =>
                        setEditingId(editingId === u.id ? null : u.id)
                      }
                    >
                      {editingId === u.id ? "Close" : "Edit"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      disabled={busyId === u.id}
                      onClick={() => void toggleStatus(u)}
                    >
                      {u.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="px-2.5 py-1 text-xs"
                      disabled={busyId === u.id}
                      onClick={() => void removeUser(u)}
                    >
                      Remove
                    </Button>
                  </div>
                )}

                {editingId === u.id && (
                  <EditUserForm
                    user={u}
                    onSaved={() => {
                      setEditingId(null);
                      loadUsers();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </>
  );
}

export default function UsersAdminPage() {
  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <UsersAdmin />
    </RoleGuard>
  );
}
