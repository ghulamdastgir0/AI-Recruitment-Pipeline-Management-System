"use client";

import { type FormEvent, useState } from "react";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
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
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">Assistant</h1>

        <div className="flex min-h-[300px] flex-col gap-3 rounded-lg border border-gray-200 p-4">
          {turns.length === 0 && (
            <p className="text-sm text-gray-500">
              Ask the assistant to create job postings, look up candidates, or
              rank applicants for a role.
            </p>
          )}
          {turns.map((turn, index) => (
            <div
              key={index}
              className={
                turn.role === "user"
                  ? "self-end rounded-lg bg-blue-600 px-3 py-2 text-sm text-white"
                  : "self-start rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800"
              }
            >
              {turn.content}
            </div>
          ))}

          {pendingAction && (
            <div className="self-start rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-800">
                Confirm action: {pendingAction.tool}
              </p>
              <pre className="mt-1 overflow-x-auto text-xs text-amber-700">
                {JSON.stringify(pendingAction.args, null, 2)}
              </pre>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={confirmAction}
                  disabled={sending}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={cancelAction}
                  disabled={sending}
                  className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <form onSubmit={send} className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Message the assistant…"
            className="flex-1 rounded border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
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
