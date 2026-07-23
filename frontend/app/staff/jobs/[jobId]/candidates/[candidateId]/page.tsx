"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { RoleGuard } from "@/components/RoleGuard";
import { apiFetch, ApiError, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface MatchResult {
  overallScore: number;
  recommendation: string;
  confidence: string;
  summary: string;
  matchedSkills: string[];
  missingRequiredSkills: string[];
}

interface TranscriptQuestion {
  sequenceOrder: number;
  questionText: string;
  answerText: string | null;
  targetSkillName: string | null;
  isFollowUp: boolean;
}

interface SkillGrade {
  skillName: string;
  proficiencyScore: number;
  justification: string;
}

interface Transcript {
  sessionStatus: string;
  overallScore: number | null;
  questions: TranscriptQuestion[];
  skillGrades: SkillGrade[];
}

interface Comment {
  id: string;
  content: string;
  authorUserId: string;
  createdAt: string;
}

type Decision = "SELECTED" | "NEXT_ROUND" | "REJECTED";

function CandidateDetail() {
  const { jobId, candidateId } = useParams<{ jobId: string; candidateId: string }>();
  const { user } = useAuth();

  const [match, setMatch] = useState<MatchResult | null>(null);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptMessage, setTranscriptMessage] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");

  const [decision, setDecision] = useState<Decision>("SELECTED");
  const [nextRoundTime, setNextRoundTime] = useState("");
  const [nextRoundDeadline, setNextRoundDeadline] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  function loadComments() {
    apiFetch<Comment[]>(
      `/job-postings/${jobId}/candidates/${candidateId}/comments`,
    )
      .then(setComments)
      .catch(() => setComments([]));
  }

  useEffect(() => {
    apiFetch<MatchResult>(`/job-postings/${jobId}/candidates/${candidateId}/match`)
      .then(setMatch)
      .catch((err) =>
        setMatchMessage(
          err instanceof ApiError ? err.message : "Failed to load match score.",
        ),
      );
    apiFetch<Transcript>(
      `/job-postings/${jobId}/candidates/${candidateId}/interview`,
    )
      .then(setTranscript)
      .catch((err) =>
        setTranscriptMessage(
          err instanceof ApiError ? err.message : "Failed to load interview.",
        ),
      );
    loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadComments is stable per render
  }, [jobId, candidateId]);

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!newComment.trim()) return;
    await postJson(`/job-postings/${jobId}/candidates/${candidateId}/comments`, {
      content: newComment,
    });
    setNewComment("");
    loadComments();
  }

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    setDecisionError(null);
    setDecisionMessage(null);
    try {
      await postJson(`/job-postings/${jobId}/candidates/${candidateId}/decision`, {
        decision,
        ...(decision === "NEXT_ROUND"
          ? {
              nextRoundTime: new Date(nextRoundTime).toISOString(),
              nextRoundDeadline: new Date(nextRoundDeadline).toISOString(),
            }
          : {}),
      });
      setDecisionMessage(`Decision "${decision}" recorded and emailed.`);
    } catch (err) {
      setDecisionError(
        err instanceof ApiError ? err.message : "Failed to record decision.",
      );
    }
  }

  const canDecide = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";
  const canComment = user?.role === "HIRING_MANAGER";

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link
        href={`/staff/jobs/${jobId}`}
        className="text-sm text-blue-600 underline"
      >
        ← Back to job
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Candidate</h1>
      <p className="text-sm text-gray-500">{candidateId}</p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Match Score</h2>
        {matchMessage && <p className="mt-2 text-sm text-gray-500">{matchMessage}</p>}
        {match && (
          <div className="mt-2 rounded-lg border border-gray-200 p-4">
            <p className="font-medium">
              {match.overallScore}/100 — {match.recommendation} ({match.confidence})
            </p>
            <p className="mt-1 text-sm text-gray-600">{match.summary}</p>
            {match.missingRequiredSkills.length > 0 && (
              <p className="mt-2 text-sm text-red-600">
                Missing: {match.missingRequiredSkills.join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">AI Interview Transcript</h2>
        {transcriptMessage && (
          <p className="mt-2 text-sm text-gray-500">{transcriptMessage}</p>
        )}
        {transcript && (
          <div className="mt-2 flex flex-col gap-4">
            <p className="text-sm text-gray-500">
              Session: {transcript.sessionStatus}
              {transcript.overallScore !== null &&
                ` · Overall score: ${transcript.overallScore}/100`}
            </p>
            {transcript.questions.map((question) => (
              <div
                key={question.sequenceOrder}
                className="rounded border border-gray-200 p-3"
              >
                <p className="text-xs text-gray-500">
                  Q{question.sequenceOrder} · {question.targetSkillName ?? "General"}
                  {question.isFollowUp ? " (follow-up)" : ""}
                </p>
                <p className="mt-1 font-medium">{question.questionText}</p>
                <p className="mt-1 text-sm text-gray-700">
                  {question.answerText ?? "(not answered)"}
                </p>
              </div>
            ))}
            {transcript.skillGrades.length > 0 && (
              <div>
                <h3 className="font-medium">Skill Grades</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {transcript.skillGrades.map((grade) => (
                    <li
                      key={grade.skillName}
                      className="rounded border border-gray-200 p-3"
                    >
                      <p className="font-medium">
                        {grade.skillName}: {grade.proficiencyScore}/100
                      </p>
                      <p className="text-sm text-gray-600">{grade.justification}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Comments</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded border border-gray-200 p-3 text-sm"
            >
              {comment.content}
            </li>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-gray-500">No comments yet.</p>
          )}
        </ul>
        {canComment && (
          <form onSubmit={submitComment} className="mt-3 flex flex-col gap-2">
            <textarea
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
              placeholder="Add a comment…"
              rows={2}
              className="rounded border border-gray-300 px-3 py-2"
            />
            <button
              type="submit"
              className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Post Comment
            </button>
          </form>
        )}
      </section>

      {canDecide && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Decision</h2>
          <form
            onSubmit={submitDecision}
            className="mt-2 flex flex-col gap-3 rounded-lg border border-gray-200 p-4"
          >
            <select
              value={decision}
              onChange={(event) => setDecision(event.target.value as Decision)}
              className="rounded border border-gray-300 px-3 py-2"
            >
              <option value="SELECTED">Selected</option>
              <option value="NEXT_ROUND">Next Round</option>
              <option value="REJECTED">Rejected</option>
            </select>
            {decision === "NEXT_ROUND" && (
              <>
                <label className="text-sm">
                  Next round time
                  <input
                    required
                    type="datetime-local"
                    value={nextRoundTime}
                    onChange={(event) => setNextRoundTime(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  Response deadline
                  <input
                    required
                    type="datetime-local"
                    value={nextRoundDeadline}
                    onChange={(event) => setNextRoundDeadline(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                  />
                </label>
              </>
            )}
            {decisionError && <p className="text-sm text-red-600">{decisionError}</p>}
            {decisionMessage && (
              <p className="text-sm text-green-600">{decisionMessage}</p>
            )}
            <button
              type="submit"
              className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Submit Decision
            </button>
          </form>
        </section>
      )}
    </main>
  );
}

export default function CandidateDetailPage() {
  return (
    <RoleGuard>
      <CandidateDetail />
    </RoleGuard>
  );
}
