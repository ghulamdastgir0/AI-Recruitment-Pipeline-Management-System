"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { FormattedMessage } from "@/components/assistant/FormattedMessage";
import { JobPostingCard, type JobPostingSummary } from "@/components/assistant/JobPostingCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError, postFormStream, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface ToolStep {
  tool: string;
  label: string;
  status: "running" | "done";
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  jobPosting?: JobPostingSummary;
  /** Live tool-call progress this turn went through — kept on the finished turn too, so the history still shows what the assistant did to get there. */
  steps?: ToolStep[];
}

interface PendingAction {
  actionId: string;
  /** Plain-English description of what confirming will do — never a raw tool name/id/args blob. */
  description: string;
  expiresAt: string;
}

interface AssistantReply {
  reply: string;
  pendingAction?: PendingAction;
  jobPosting?: JobPostingSummary;
}

/** Matches backend AssistantStreamEvent (assistant/assistant-stream-event.ts) — kept as a local literal type since the frontend doesn't share types with the backend. */
type StreamEvent =
  | { type: "tool"; tool: string; phase: "start" | "end"; label: string }
  | ({ type: "final" } & AssistantReply)
  | { type: "error"; message: string };

function BotIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="14" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.4" fill="currentColor" stroke="none" />
      <path d="M9 17.5c1 .7 5 .7 6 0" />
      <path d="M2 13v3" />
      <path d="M22 13v3" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="42"
        strokeDashoffset="14"
        opacity="0.85"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** One "✓ Searched policies…" / "⟳ Ranking candidates…" line in the live tool-progress checklist. */
function ToolStepRow({ step }: { step: ToolStep }) {
  return (
    <div className="flex items-center gap-1.5 text-xs italic text-text-muted">
      {step.status === "running" ? (
        <SpinnerIcon className="h-3 w-3 shrink-0 animate-spin text-brand-600" />
      ) : (
        <CheckIcon className="h-3 w-3 shrink-0 text-emerald-500" />
      )}
      <span>{step.label}</span>
    </div>
  );
}

/**
 * Floating chat entry point for the recruitment assistant, replacing the old
 * dedicated /staff/assistant page. Rendered once by StaffNav (present at the
 * top of every staff page) so it follows any signed-in staff user — HR/Admin
 * and Hiring Managers alike, since the assistant's tool set is now scoped
 * server-side per role.
 */
export function AssistantWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [sending, setSending] = useState(false);
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pendingAction, liveSteps, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  if (!user) return null;
  const canUseAssistant =
    user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN" || user.role === "HIRING_MANAGER";
  if (!canUseAssistant) return null;

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    setLiveSteps([]);
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

      const response = await postFormStream("/assistant/message", form);
      const steps: ToolStep[] = [];
      let final: (AssistantReply & { type: "final" }) | null = null;

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");
          if (!line) continue;

          const streamEvent = JSON.parse(line) as StreamEvent;
          if (streamEvent.type === "tool") {
            if (streamEvent.phase === "start") {
              steps.push({ tool: streamEvent.tool, label: streamEvent.label, status: "running" });
            } else {
              const running = [...steps].reverse().find(
                (s) => s.tool === streamEvent.tool && s.status === "running",
              );
              if (running) running.status = "done";
            }
            setLiveSteps([...steps]);
          } else if (streamEvent.type === "final") {
            final = streamEvent;
          } else if (streamEvent.type === "error") {
            throw new Error(streamEvent.message);
          }
        }
      }

      if (!final) throw new Error("The assistant didn't return a reply.");
      const finishedSteps = steps.map((s) => ({ ...s, status: "done" as const }));
      setTurns([
        ...nextTurns,
        {
          role: "assistant",
          content: final.reply,
          jobPosting: final.jobPosting,
          steps: finishedSteps,
        },
      ]);
      setPendingAction(final.pendingAction ?? null);
      setAttachedFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
      setLiveSteps([]);
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
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close assistant" : "Open recruitment assistant"}
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-transform hover:bg-brand-700 hover:scale-105"
      >
        <BotIcon className="h-7 w-7" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Recruitment assistant"
          className="fixed bottom-24 right-6 z-30 flex h-[70vh] max-h-[560px] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="font-heading text-sm font-semibold text-text-primary">
                Recruitment Assistant
              </p>
              <p className="text-xs text-text-muted">
                {user.role === "HIRING_MANAGER"
                  ? "Ask about candidates on your assigned jobs"
                  : "Job postings, CVs, ranking, and decisions"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-full p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <p className="max-w-xs text-center text-sm text-text-muted">
                  {user.role === "HIRING_MANAGER"
                    ? "Ask the assistant to list your assigned jobs, review a candidate's interview, or leave feedback."
                    : "Ask the assistant to create job postings, look up candidates, rank applicants, or record a decision."}
                </p>
              </div>
            )}
            {turns.map((turn, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[85%] self-end rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white"
                      : "max-w-[90%] self-start rounded-2xl rounded-bl-sm bg-surface-muted px-3.5 py-2 text-sm text-text-primary"
                  }
                >
                  {turn.role === "assistant" ? (
                    <div className="flex flex-col gap-1.5">
                      {turn.steps && turn.steps.length > 0 && (
                        <div className="flex flex-col gap-1 border-b border-border/60 pb-1.5">
                          {turn.steps.map((step, stepIndex) => (
                            <ToolStepRow key={stepIndex} step={step} />
                          ))}
                        </div>
                      )}
                      <FormattedMessage content={turn.content} />
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{turn.content}</span>
                  )}
                </div>
                {turn.jobPosting && (
                  <div className="self-start">
                    <JobPostingCard job={turn.jobPosting} />
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="max-w-[90%] self-start rounded-2xl rounded-bl-sm bg-surface-muted px-3.5 py-2 text-sm text-text-primary">
                <div className="flex flex-col gap-1">
                  {liveSteps.length === 0 ? (
                    <ToolStepRow step={{ tool: "", label: "Thinking…", status: "running" }} />
                  ) : (
                    liveSteps.map((step, stepIndex) => (
                      <ToolStepRow key={stepIndex} step={step} />
                    ))
                  )}
                </div>
              </div>
            )}

            {pendingAction && (
              <div className="max-w-[90%] self-start rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft p-3 text-sm">
                <p className="text-warning-text">
                  Please confirm: <span className="font-medium">{pendingAction.description}</span>
                </p>
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

          {error && <p className="px-4 text-xs text-danger">{error}</p>}

          <form onSubmit={send} className="flex flex-col gap-2 border-t border-border p-3">
            {attachedFile && (
              <div className="flex items-center gap-2 self-start rounded-full bg-surface-muted px-3 py-1 text-xs text-text-secondary">
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
              {user.role !== "HIRING_MANAGER" && (
                <label className="flex cursor-pointer items-center rounded-[var(--radius-control)] border border-border bg-surface-card px-3 text-sm text-text-secondary hover:bg-surface-muted">
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
              )}
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Message the assistant…"
                maxLength={4000}
                className="flex-1"
              />
              <Button type="submit" disabled={sending || !input.trim()} className="px-3">
                {sending ? "…" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
