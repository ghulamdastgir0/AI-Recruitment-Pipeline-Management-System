"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { PermissionDeniedState } from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { Timeline } from "@/components/Timeline";
import {
  apiFetch,
  ApiError,
  downloadFile,
  isForbidden,
  postJson,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface MatchResult {
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  applicationStatus: string;
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
  const [forbidden, setForbidden] = useState(false);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptMessage, setTranscriptMessage] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");

  const [decision, setDecision] = useState<Decision>("SELECTED");
  const [nextRoundTime, setNextRoundTime] = useState("");
  const [nextRoundDeadline, setNextRoundDeadline] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const [managerReviewMessage, setManagerReviewMessage] = useState<
    string | null
  >(null);
  const [managerReviewError, setManagerReviewError] = useState<string | null>(
    null,
  );
  const [movingToManagerReview, setMovingToManagerReview] = useState(false);

  function loadMatch() {
    apiFetch<MatchResult>(`/job-postings/${jobId}/candidates/${candidateId}/match`)
      .then(setMatch)
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else
          setMatchMessage(
            err instanceof ApiError ? err.message : "Failed to load match score.",
          );
      });
  }

  function loadComments() {
    apiFetch<Comment[]>(
      `/job-postings/${jobId}/candidates/${candidateId}/comments`,
    )
      .then(setComments)
      .catch(() => setComments([]));
  }

  useEffect(() => {
    loadMatch();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMatch/loadComments are stable per render
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
      loadMatch();
    } catch (err) {
      setDecisionError(
        err instanceof ApiError ? err.message : "Failed to record decision.",
      );
    }
  }

  async function moveToManagerReview() {
    setMovingToManagerReview(true);
    setManagerReviewError(null);
    setManagerReviewMessage(null);
    try {
      await postJson(
        `/job-postings/${jobId}/candidates/${candidateId}/manager-review`,
        {},
      );
      setManagerReviewMessage("Moved to manager review.");
      loadMatch();
    } catch (err) {
      setManagerReviewError(
        err instanceof ApiError ? err.message : "Failed to update status.",
      );
    } finally {
      setMovingToManagerReview(false);
    }
  }

  const canDecide = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";
  const canComment = user?.role === "HIRING_MANAGER";

  if (forbidden) {
    return (
      <>
        <StaffNav />
        <main className="mx-auto w-full max-w-3xl p-6">
          <PermissionDeniedState />
        </main>
      </>
    );
  }

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-3xl p-6">
        <Link
          href={`/staff/jobs/${jobId}`}
          className="text-sm text-blue-600 underline"
        >
          ← Back to job
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          {match?.candidateName ?? "Candidate"}
        </h1>
        <p className="text-sm text-gray-500">
          {[match?.candidateEmail, match?.candidatePhone].filter(Boolean).join(" · ") ||
            candidateId}
        </p>

        {match && (
          <div className="mt-4">
            <Timeline status={match.applicationStatus} />
          </div>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Match Score</h2>
          <p className="mt-1 text-xs text-gray-500">
            AI score is a recommendation and requires HR review.
          </p>
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
              <button
                onClick={() =>
                  void downloadFile(
                    `/job-postings/${jobId}/candidates/${candidateId}/cv`,
                    `${match.candidateName ?? candidateId}.pdf`,
                  )
                }
                className="mt-3 rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
              >
                Download CV
              </button>
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold">AI Interview Transcript</h2>
          <p className="mt-1 text-xs text-gray-500">
            AI score is a recommendation and requires HR review.
          </p>
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

        {canDecide && match?.applicationStatus === "IN_REVIEW" && (
          <section className="mt-6 rounded-lg border border-gray-200 p-4">
            <h2 className="text-lg font-semibold">Manager Review</h2>
            <p className="mt-1 text-sm text-gray-600">
              The AI interview is complete. Move this candidate into manager
              review before making a final decision.
            </p>
            <button
              onClick={moveToManagerReview}
              disabled={movingToManagerReview}
              className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {movingToManagerReview ? "Moving…" : "Move to Manager Review"}
            </button>
            {managerReviewError && (
              <p className="mt-2 text-sm text-red-600">{managerReviewError}</p>
            )}
            {managerReviewMessage && (
              <p className="mt-2 text-sm text-green-600">{managerReviewMessage}</p>
            )}
          </section>
        )}

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
    </>
  );
}

export default function CandidateDetailPage() {
  return (
    <RoleGuard>
      <CandidateDetail />
    </RoleGuard>
  );
}
