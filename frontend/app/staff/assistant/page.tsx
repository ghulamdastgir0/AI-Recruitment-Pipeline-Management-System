"use client";

import { type FormEvent, useState } from "react";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { apiFetch, ApiError, postJson } from "@/lib/api";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface PendingAction {
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  expiresAt: string;
}

interface AssistantReply {
  reply: string;
  pendingAction?: PendingAction;
}

function AssistantChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    const nextTurns = [...turns, { role: "user" as const, content: message }];
    setTurns(nextTurns);
    setInput("");
    try {
      const form = new FormData();
      form.append("message", message);
      form.append("history", JSON.stringify(turns));
      const result = await apiFetch<AssistantReply>("/assistant/message", {
        method: "POST",
        body: form,
      });
      setTurns([...nextTurns, { role: "assistant", content: result.reply }]);
      setPendingAction(result.pendingAction ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setSending(true);
    setError(null);
    try {
      const result = await postJson<AssistantReply>(
        `/assistant/actions/${pendingAction.actionId}/confirm`,
        {},
      );
      setTurns((prev) => [...prev, { role: "assistant", content: result.reply }]);
      setPendingAction(result.pendingAction ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to confirm action.");
    } finally {
      setSending(false);
    }
  }

  async function cancelAction() {
    if (!pendingAction) return;
    setSending(true);
    setError(null);
    try {
      await postJson(`/assistant/actions/${pendingAction.actionId}/cancel`, {});
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "Action cancelled." },
      ]);
      setPendingAction(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel action.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <StaffNav />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Recruitment Assistant
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Draft job postings, screen candidates, and get answers on company
            policy — sensitive actions always ask for confirmation first.
          </p>
        </div>

        <Card className="flex min-h-[400px] flex-col gap-3 p-4">
          {turns.length === 0 && (
            <p className="text-sm text-text-muted">
              Ask the assistant to create job postings, look up candidates, or
              rank applicants for a role.
            </p>
          )}
          {turns.map((turn, index) => (
            <div
              key={index}
              className={
                turn.role === "user"
                  ? "self-end rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white"
                  : "self-start rounded-2xl rounded-bl-sm bg-black/5 px-3.5 py-2 text-sm text-text-primary"
              }
            >
              {turn.content}
            </div>
          ))}

          {pendingAction && (
            <div className="self-start rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft p-3 text-sm">
              <p className="font-medium text-warning-text">
                Confirm action: {pendingAction.tool}
              </p>
              <pre className="mt-1 overflow-x-auto text-xs text-warning-text">
                {JSON.stringify(pendingAction.args, null, 2)}
              </pre>
              <div className="mt-2 flex gap-2">
                <Button
                  onClick={confirmAction}
                  disabled={sending}
                  className="px-3 py-1 text-xs"
                >
                  Confirm
                </Button>
                <Button
                  variant="secondary"
                  onClick={cancelAction}
                  disabled={sending}
                  className="px-3 py-1 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <form onSubmit={send} className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Message the assistant…"
            className="flex-1"
          />
          <Button type="submit" disabled={sending || !input.trim()}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </form>
      </main>
    </>
  );
}

export default function AssistantPage() {
  return (
    <RoleGuard roles={["SUPER_ADMIN", "HR_ADMIN"]}>
      <AssistantChat />
    </RoleGuard>
  );
}
