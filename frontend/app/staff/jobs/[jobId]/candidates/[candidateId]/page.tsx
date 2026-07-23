"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { PermissionDeniedState } from "@/components/AsyncState";
import { isRejectedStatus, RejectionDetails } from "@/components/RejectionDetails";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { Timeline } from "@/components/Timeline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
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
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <Link
          href={`/staff/jobs/${jobId}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← Back to job
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold text-text-primary">
          {match?.candidateName ?? "Candidate"}
        </h1>
        <p className="text-sm text-text-muted">
          {[match?.candidateEmail, match?.candidatePhone].filter(Boolean).join(" · ") ||
            candidateId}
        </p>

        {match && (
          <div className="mt-4">
            <Timeline status={match.applicationStatus} />
          </div>
        )}

        <section className="mt-8">
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Match Score
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            AI score is a recommendation and requires HR review.
          </p>
          {matchMessage && <p className="mt-2 text-sm text-text-muted">{matchMessage}</p>}
          {match && (
            <Card className="mt-2">
              <p className="font-medium text-text-primary">
                {match.overallScore}/100 — {match.recommendation} ({match.confidence})
              </p>
              {isRejectedStatus(match.applicationStatus) ? (
                <RejectionDetails
                  info={{
                    overallScore: match.overallScore,
                    summary: match.summary,
                    missingRequiredSkills: match.missingRequiredSkills,
                  }}
                />
              ) : (
                <>
                  <p className="mt-1 text-sm text-text-secondary">{match.summary}</p>
                  {match.missingRequiredSkills.length > 0 && (
                    <p className="mt-2 text-sm text-danger">
                      Missing: {match.missingRequiredSkills.join(", ")}
                    </p>
                  )}
                </>
              )}
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadFile(
                    `/job-postings/${jobId}/candidates/${candidateId}/cv`,
                    `${match.candidateName ?? candidateId}.pdf`,
                  )
                }
                className="mt-3 px-2.5 py-1 text-xs"
              >
                Download CV
              </Button>
            </Card>
          )}
        </section>

        <section className="mt-8">
          <h2 className="font-heading text-base font-semibold text-text-primary">
            AI Interview Transcript
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            AI score is a recommendation and requires HR review.
          </p>
          {transcriptMessage && (
            <p className="mt-2 text-sm text-text-muted">{transcriptMessage}</p>
          )}
          {transcript && (
            <div className="mt-2 flex flex-col gap-4">
              <p className="text-sm text-text-muted">
                Session: {transcript.sessionStatus}
                {transcript.overallScore !== null &&
                  ` · Overall score: ${transcript.overallScore}/100`}
              </p>
              {transcript.questions.map((question) => (
                <Card key={question.sequenceOrder} className="p-3">
                  <p className="text-xs text-text-muted">
                    Q{question.sequenceOrder} · {question.targetSkillName ?? "General"}
                    {question.isFollowUp ? " (follow-up)" : ""}
                  </p>
                  <p className="mt-1 font-medium text-text-primary">{question.questionText}</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    {question.answerText ?? "(not answered)"}
                  </p>
                </Card>
              ))}
              {transcript.skillGrades.length > 0 && (
                <div>
                  <h3 className="font-medium text-text-primary">Skill Grades</h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {transcript.skillGrades.map((grade) => (
                      <Card key={grade.skillName} as="li" className="p-3">
                        <p className="font-medium text-text-primary">
                          {grade.skillName}: {grade.proficiencyScore}/100
                        </p>
                        <p className="text-sm text-text-secondary">{grade.justification}</p>
                      </Card>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Comments
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {comments.map((comment) => (
              <Card key={comment.id} as="li" className="p-3 text-sm text-text-secondary">
                {comment.content}
              </Card>
            ))}
            {comments.length === 0 && (
              <p className="text-sm text-text-muted">No comments yet.</p>
            )}
          </ul>
          {canComment && (
            <form onSubmit={submitComment} className="mt-3 flex flex-col gap-2">
              <Textarea
                value={newComment}
                onChange={(event) => setNewComment(event.target.value)}
                placeholder="Add a comment…"
                rows={2}
              />
              <Button type="submit" className="self-start">
                Post Comment
              </Button>
            </form>
          )}
        </section>

        {canDecide && match?.applicationStatus === "IN_REVIEW" && (
          <Card className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Manager Review
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              The AI interview is complete. Move this candidate into manager
              review before making a final decision.
            </p>
            <Button
              onClick={moveToManagerReview}
              disabled={movingToManagerReview}
              className="mt-3"
            >
              {movingToManagerReview ? "Moving…" : "Move to Manager Review"}
            </Button>
            {managerReviewError && (
              <p className="mt-2 text-sm text-danger">{managerReviewError}</p>
            )}
            {managerReviewMessage && (
              <p className="mt-2 text-sm text-success-text">{managerReviewMessage}</p>
            )}
          </Card>
        )}

        {canDecide && (
          <section className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Decision
            </h2>
            <Card className="mt-2">
              <form onSubmit={submitDecision} className="flex flex-col gap-3">
                <select
                  value={decision}
                  onChange={(event) => setDecision(event.target.value as Decision)}
                  className="rounded-[var(--radius-control)] border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  <option value="SELECTED">Selected</option>
                  <option value="NEXT_ROUND">Next Round</option>
                  <option value="REJECTED">Rejected</option>
                </select>
                {decision === "NEXT_ROUND" && (
                  <>
                    <label className="text-sm text-text-secondary">
                      Next round time
                      <input
                        required
                        type="datetime-local"
                        value={nextRoundTime}
                        onChange={(event) => setNextRoundTime(event.target.value)}
                        className="mt-1 w-full rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                    <label className="text-sm text-text-secondary">
                      Response deadline
                      <input
                        required
                        type="datetime-local"
                        value={nextRoundDeadline}
                        onChange={(event) => setNextRoundDeadline(event.target.value)}
                        className="mt-1 w-full rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                  </>
                )}
                {decisionError && <p className="text-sm text-danger">{decisionError}</p>}
                {decisionMessage && (
                  <p className="text-sm text-success-text">{decisionMessage}</p>
                )}
                <Button type="submit" className="self-start">
                  Submit Decision
                </Button>
              </form>
            </Card>
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
