"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { FormattedMessage } from "@/components/assistant/FormattedMessage";
import { JobPostingCard, type JobPostingSummary } from "@/components/assistant/JobPostingCard";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { apiFetch, ApiError, postJson } from "@/lib/api";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  jobPosting?: JobPostingSummary;
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
  jobPosting?: JobPostingSummary;
}

function AssistantChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Keeps the scrollable message list (not the whole page) pinned to the
  // latest turn as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pendingAction]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    const attachedLabel = attachedFile ? ` (attached: ${attachedFile.name})` : "";
    const nextTurns = [
      ...turns,
      { role: "user" as const, content: message + attachedLabel },
    ];
    setTurns(nextTurns);
    setInput("");
    try {
      const form = new FormData();
      form.append("message", message);
      form.append("history", JSON.stringify(turns));
      if (attachedFile) form.append("file", attachedFile);
      const result = await apiFetch<AssistantReply>("/assistant/message", {
        method: "POST",
        body: form,
      });
      setTurns([
        ...nextTurns,
        { role: "assistant", content: result.reply, jobPosting: result.jobPosting },
      ]);
      setPendingAction(result.pendingAction ?? null);
      setAttachedFile(null);
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
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: result.reply, jobPosting: result.jobPosting },
      ]);
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

        <Card className="flex h-[65vh] flex-col overflow-hidden p-0">
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <p className="max-w-xs text-center text-sm text-text-muted">
                  Ask the assistant to create job postings, look up candidates,
                  or rank applicants for a role.
                </p>
              </div>
            )}
            {turns.map((turn, index) => (
              <div
                key={index}
                className={
                  turn.role === "user"
                    ? "max-w-[85%] self-end rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white"
                    : "max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-black/5 px-3.5 py-2 text-sm text-text-primary"
                }
              >
                {turn.role === "assistant" ? (
                  <FormattedMessage content={turn.content} />
                ) : (
                  <span className="whitespace-pre-wrap">{turn.content}</span>
                )}
              </div>
            ))}

            {pendingAction && (
              <div className="max-w-[85%] self-start rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft p-3 text-sm">
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
            <div ref={bottomRef} />
          </div>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <form onSubmit={send} className="flex flex-col gap-2">
          {attachedFile && (
            <div className="flex items-center gap-2 self-start rounded-full bg-black/5 px-3 py-1 text-xs text-text-secondary">
              <span>📎 {attachedFile.name}</span>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="font-medium text-text-muted hover:text-text-primary"
                aria-label="Remove attached file"
              >
                ×
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <label className="flex cursor-pointer items-center rounded-[var(--radius-control)] border border-border bg-white px-3 text-sm text-text-secondary hover:bg-black/5">
              <span>📎</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) =>
                  setAttachedFile(event.target.files?.[0] ?? null)
                }
              />
            </label>
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Message the assistant…"
              maxLength={4000}
              className="flex-1"
            />
            <Button type="submit" disabled={sending || !input.trim()}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
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
