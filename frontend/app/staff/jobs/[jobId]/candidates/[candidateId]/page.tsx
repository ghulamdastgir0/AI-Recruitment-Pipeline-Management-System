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
import { Dialog } from "@/components/ui/Dialog";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  apiFetch,
  ApiError,
  downloadFile,
  isForbidden,
  postJson,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";

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

interface ViolationSummary {
  counts: Record<string, number>;
  total: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

interface Transcript {
  sessionStatus: string;
  overallScore: number | null;
  recommendation: string | null;
  summary: string | null;
  terminationReason: string | null;
  questions: TranscriptQuestion[];
  skillGrades: SkillGrade[];
  violations: ViolationSummary;
}

const RISK_STYLES: Record<ViolationSummary["riskLevel"], string> = {
  LOW: "bg-success-soft text-success-text",
  MEDIUM: "bg-warning-soft text-warning-text",
  HIGH: "bg-danger-soft text-danger-text",
  CRITICAL: "bg-danger-soft text-danger-text",
};

function RiskBadge({ riskLevel }: { riskLevel: ViolationSummary["riskLevel"] }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${RISK_STYLES[riskLevel]}`}
    >
      {riskLevel} risk
    </span>
  );
}

interface Comment {
  id: string;
  content: string;
  authorUserId: string;
  /** Several Hiring Managers can be assigned to the same job posting — always show whose comment this is. */
  authorName: string;
  createdAt: string;
}

function formatCommentDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Explains, for a Hiring Manager, why neither the "Mark as Reviewed" nor
// "Reviewed" card is showing — MANAGER_REVIEW/MANAGER_REVIEWED get their own
// dedicated card instead (see below) and aren't in this map, so a manager
// never lands on a candidate with a review-related section that's just
// silently absent with no explanation.
const MANAGER_REVIEW_GAP_MESSAGE: Record<string, string> = {
  APPLIED: "This candidate hasn't completed their AI interview yet.",
  SCREENING: "This candidate hasn't completed their AI interview yet.",
  SCREENING_REJECTED: "This candidate was screened out before an interview.",
  INTERVIEW_PENDING: "This candidate hasn't completed their AI interview yet.",
  INTERVIEW_EXPIRED:
    "This candidate's interview window expired before they completed it.",
  IN_REVIEW:
    "The AI interview is complete, but HR hasn't moved this candidate into manager review yet — check back once they do.",
  WITHDRAWN: "This candidate withdrew their application.",
  SELECTED: "HR selected this candidate and is preparing the offer letter.",
  NEXT_ROUND: "HR advanced this candidate to another interview round.",
  REJECTED: "HR has already rejected this candidate.",
  HIRED: "This candidate has been hired.",
};

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
  const [commentsMessage, setCommentsMessage] = useState<string | null>(null);
  const [showAddCommentDialog, setShowAddCommentDialog] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [downloadingCv, setDownloadingCv] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [decision, setDecision] = useState<Decision>("SELECTED");
  const [nextRoundTime, setNextRoundTime] = useState("");
  const [nextRoundDeadline, setNextRoundDeadline] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  const [managerReviewMessage, setManagerReviewMessage] = useState<
    string | null
  >(null);
  const [managerReviewError, setManagerReviewError] = useState<string | null>(
    null,
  );
  const [movingToManagerReview, setMovingToManagerReview] = useState(false);

  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const [revertingReview, setRevertingReview] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const [offerDetails, setOfferDetails] = useState("");
  const [offerMessage, setOfferMessage] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [sendingOffer, setSendingOffer] = useState(false);

  const [revertingDecision, setRevertingDecision] = useState(false);
  const [revertDecisionError, setRevertDecisionError] = useState<
    string | null
  >(null);

  const [showDirectRejectDialog, setShowDirectRejectDialog] = useState(false);
  const [directRejectError, setDirectRejectError] = useState<string | null>(
    null,
  );
  const [submittingDirectReject, setSubmittingDirectReject] = useState(false);

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
      .then((rows) => {
        setComments(rows);
        setCommentsMessage(null);
      })
      .catch((err) => {
        setComments([]);
        setCommentsMessage(
          err instanceof ApiError ? err.message : "Failed to load comments.",
        );
      });
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
    if (!newComment.trim() || submittingComment) return;
    setSubmittingComment(true);
    setCommentError(null);
    try {
      await postJson(`/job-postings/${jobId}/candidates/${candidateId}/comments`, {
        content: newComment,
      });
      setNewComment("");
      setShowAddCommentDialog(false);
      loadComments();
    } catch (err) {
      setCommentError(
        err instanceof ApiError ? err.message : "Failed to post comment.",
      );
    } finally {
      setSubmittingComment(false);
    }
  }

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    if (submittingDecision) return;
    setSubmittingDecision(true);
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
      showToast(`Decision "${decision}" recorded and emailed.`);
      loadMatch();
    } catch (err) {
      setDecisionError(
        err instanceof ApiError ? err.message : "Failed to record decision.",
      );
    } finally {
      setSubmittingDecision(false);
    }
  }

  async function submitDirectReject() {
    if (submittingDirectReject) return;
    setSubmittingDirectReject(true);
    setDirectRejectError(null);
    try {
      await postJson(`/job-postings/${jobId}/candidates/${candidateId}/decision`, {
        decision: "REJECTED",
      });
      setShowDirectRejectDialog(false);
      setDecisionMessage('Decision "REJECTED" recorded and emailed.');
      showToast('Decision "REJECTED" recorded and emailed.');
      loadMatch();
    } catch (err) {
      setDirectRejectError(
        err instanceof ApiError ? err.message : "Failed to reject candidate.",
      );
    } finally {
      setSubmittingDirectReject(false);
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
      showToast("Moved to manager review.");
      loadMatch();
    } catch (err) {
      setManagerReviewError(
        err instanceof ApiError ? err.message : "Failed to update status.",
      );
    } finally {
      setMovingToManagerReview(false);
    }
  }

  async function submitManagerReviewed(event: FormEvent) {
    event.preventDefault();
    if (submittingReview || !reviewComment.trim()) return;
    setSubmittingReview(true);
    setReviewError(null);
    try {
      await postJson(
        `/job-postings/${jobId}/candidates/${candidateId}/manager-reviewed`,
        { comment: reviewComment },
      );
      setShowReviewDialog(false);
      setReviewComment("");
      showToast("Review submitted.");
      loadComments();
      loadMatch();
    } catch (err) {
      setReviewError(
        err instanceof ApiError ? err.message : "Failed to submit review.",
      );
    } finally {
      setSubmittingReview(false);
    }
  }

  async function revertReview() {
    if (revertingReview) return;
    const confirmed = await confirm(
      "Revert this review? The application goes back to awaiting your review, and your existing comment stays on record.",
      { title: "Revert review", confirmLabel: "Revert" },
    );
    if (!confirmed) {
      return;
    }
    setRevertingReview(true);
    setRevertError(null);
    try {
      await postJson(
        `/job-postings/${jobId}/candidates/${candidateId}/manager-reviewed/revert`,
        {},
      );
      showToast("Review reverted — you can amend it now.");
      loadMatch();
    } catch (err) {
      setRevertError(
        err instanceof ApiError ? err.message : "Failed to revert review.",
      );
    } finally {
      setRevertingReview(false);
    }
  }

  async function revertDecision() {
    if (revertingDecision) return;
    const confirmed = await confirm(
      "Undo this decision? The application goes back to awaiting your decision, so you can pick differently.",
      { title: "Change decision", confirmLabel: "Change decision" },
    );
    if (!confirmed) {
      return;
    }
    setRevertingDecision(true);
    setRevertDecisionError(null);
    try {
      await postJson(
        `/job-postings/${jobId}/candidates/${candidateId}/decision/revert`,
        {},
      );
      setDecisionMessage(null);
      showToast("Decision reverted — you can decide again.");
      loadMatch();
    } catch (err) {
      setRevertDecisionError(
        err instanceof ApiError ? err.message : "Failed to revert decision.",
      );
    } finally {
      setRevertingDecision(false);
    }
  }

  async function sendOfferLetter(event: FormEvent) {
    event.preventDefault();
    if (sendingOffer) return;
    setSendingOffer(true);
    setOfferError(null);
    setOfferMessage(null);
    try {
      await postJson(`/job-postings/${jobId}/candidates/${candidateId}/offer-letter`, {
        ...(offerDetails.trim() ? { offerDetails: offerDetails.trim() } : {}),
      });
      setOfferMessage("Offer letter sent.");
      showToast("Offer letter sent.");
      loadMatch();
    } catch (err) {
      setOfferError(
        err instanceof ApiError ? err.message : "Failed to send offer letter.",
      );
    } finally {
      setSendingOffer(false);
    }
  }

  const canDecide = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";
  const canComment = user?.role === "HIRING_MANAGER";

  if (forbidden) {
    return (
      <StaffNav title="Candidate">
        <PermissionDeniedState />
      </StaffNav>
    );
  }

  return (
    <StaffNav title={match?.candidateName ?? "Candidate"}>
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href={`/staff/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-2 text-sm text-text-muted">
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
                    interviewTerminationReason: transcript?.terminationReason,
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
                disabled={downloadingCv}
                onClick={async () => {
                  setDownloadingCv(true);
                  try {
                    await downloadFile(
                      `/job-postings/${jobId}/candidates/${candidateId}/cv`,
                      `${match.candidateName ?? candidateId}.pdf`,
                    );
                  } catch (err) {
                    showToast(
                      err instanceof ApiError ? err.message : "Failed to download CV.",
                      "danger",
                    );
                  } finally {
                    setDownloadingCv(false);
                  }
                }}
                className="mt-3 px-2.5 py-1 text-xs"
              >
                {downloadingCv ? "Downloading…" : "Download CV"}
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
              {(transcript.recommendation ?? transcript.summary) && (
                <Card className="p-3">
                  {transcript.recommendation && (
                    <p className="font-medium text-text-primary">
                      Interview recommendation:{" "}
                      {transcript.recommendation.replaceAll("_", " ")}
                    </p>
                  )}
                  {transcript.summary && (
                    <p className="mt-1 text-sm text-text-secondary">
                      {transcript.summary}
                    </p>
                  )}
                </Card>
              )}
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

        {transcript && transcript.violations.total > 0 && (
          <section className="mt-8">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-base font-semibold text-text-primary">
                Proctoring
              </h2>
              <RiskBadge riskLevel={transcript.violations.riskLevel} />
            </div>
            {transcript.terminationReason && (
              <p className="mt-1 text-xs text-warning-text">
                {transcript.terminationReason === "AUTO_SUBMITTED_VIOLATIONS"
                  ? "This interview was auto-submitted after the candidate exceeded the maximum allowed warnings."
                  : "This interview was auto-submitted after the candidate's browser/tab was closed mid-session."}
              </p>
            )}
            <Card className="mt-2 p-3">
              <p className="font-medium text-text-primary">
                {transcript.violations.total} warning
                {transcript.violations.total === 1 ? "" : "s"} recorded
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-text-secondary">
                {Object.entries(transcript.violations.counts).map(([type, count]) => (
                  <li key={type} className="flex items-center justify-between">
                    <span>{type.replaceAll("_", " ")}</span>
                    <span className="font-medium text-text-primary">{count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Comments
            </h2>
            {canComment && (
              <Button
                variant="secondary"
                onClick={() => setShowAddCommentDialog(true)}
                className="px-2.5 py-1 text-xs"
              >
                Add Comment
              </Button>
            )}
          </div>
          {commentsMessage && (
            <p className="mt-2 text-sm text-danger">{commentsMessage}</p>
          )}
          <ul className="mt-2 flex flex-col gap-2">
            {comments.map((comment) => (
              <Card key={comment.id} as="li" className="p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-text-primary">
                    {comment.authorName}
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {formatCommentDate(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-text-secondary">{comment.content}</p>
              </Card>
            ))}
            {comments.length === 0 && !commentsMessage && (
              <p className="text-sm text-text-muted">No comments yet.</p>
            )}
          </ul>
        </section>

        <Dialog
          open={showAddCommentDialog}
          onClose={() => {
            if (submittingComment) return;
            setShowAddCommentDialog(false);
            setCommentError(null);
          }}
          title="Add a comment"
        >
          <form onSubmit={submitComment} className="flex flex-col gap-3">
            <Textarea
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
              placeholder="Add a comment…"
              rows={4}
              maxLength={2000}
              disabled={submittingComment}
              autoFocus
              required
            />
            {commentError && <p className="text-sm text-danger">{commentError}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={submittingComment}
                onClick={() => {
                  setShowAddCommentDialog(false);
                  setCommentError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submittingComment || !newComment.trim()}
              >
                {submittingComment ? "Posting…" : "Post Comment"}
              </Button>
            </div>
          </form>
        </Dialog>

        {canComment && match?.applicationStatus === "MANAGER_REVIEW" && (
          <Card className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Mark as Reviewed
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Add your review comment and hand this candidate off to HR for a
              final decision.
            </p>
            <Button onClick={() => setShowReviewDialog(true)} className="mt-3">
              Mark as Reviewed
            </Button>
          </Card>
        )}

        {canComment && match?.applicationStatus === "MANAGER_REVIEWED" && (
          <Card className="mt-8">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-base font-semibold text-text-primary">
                Reviewed
              </h2>
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-text">
                Awaiting HR decision
              </span>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              You&apos;ve submitted your review. You can still revert it to
              amend your comment as long as HR hasn&apos;t made a final
              decision yet.
            </p>
            {revertError && (
              <p className="mt-2 text-sm text-danger">{revertError}</p>
            )}
            <Button
              variant="secondary"
              onClick={() => void revertReview()}
              disabled={revertingReview}
              className="mt-3"
            >
              {revertingReview ? "Reverting…" : "Revert Review"}
            </Button>
          </Card>
        )}

        {canComment && match && MANAGER_REVIEW_GAP_MESSAGE[match.applicationStatus] && (
          <Card className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Review
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {MANAGER_REVIEW_GAP_MESSAGE[match.applicationStatus]}
            </p>
          </Card>
        )}

        <Dialog
          open={showReviewDialog}
          onClose={() => {
            if (submittingReview) return;
            setShowReviewDialog(false);
            setReviewError(null);
          }}
          title="Mark as Reviewed"
        >
          <form onSubmit={submitManagerReviewed} className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              This posts your comment and moves the application to manager
              reviewed, ready for HR&apos;s final decision.
            </p>
            <Textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder="Add your review comment…"
              rows={4}
              maxLength={2000}
              disabled={submittingReview}
              autoFocus
            />
            {reviewError && <p className="text-sm text-danger">{reviewError}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={submittingReview}
                onClick={() => {
                  setShowReviewDialog(false);
                  setReviewError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submittingReview || !reviewComment.trim()}
              >
                {submittingReview ? "Submitting…" : "Submit & Mark Reviewed"}
              </Button>
            </div>
          </form>
        </Dialog>

        {canDecide && match?.applicationStatus === "IN_REVIEW" && (
          <Card className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Manager Review
            </h2>
            {transcript?.terminationReason && (
              <p className="mt-1 rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm text-warning-text">
                This interview was auto-submitted by the proctoring system (
                {transcript.terminationReason === "AUTO_SUBMITTED_VIOLATIONS"
                  ? "exceeded the maximum allowed warnings"
                  : "browser/tab closed mid-session"}
                ) — you can reject directly below without waiting on manager
                review.
              </p>
            )}
            <p className="mt-1 text-sm text-text-secondary">
              The AI interview is complete. Move this candidate into manager
              review before making a final decision.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={moveToManagerReview}
                disabled={movingToManagerReview}
              >
                {movingToManagerReview ? "Moving…" : "Move to Manager Review"}
              </Button>
              {transcript?.terminationReason && (
                <Button
                  variant="destructive"
                  onClick={() => setShowDirectRejectDialog(true)}
                >
                  Reject Directly
                </Button>
              )}
            </div>
            {managerReviewError && (
              <p className="mt-2 text-sm text-danger">{managerReviewError}</p>
            )}
            {managerReviewMessage && (
              <p className="mt-2 text-sm text-success-text">{managerReviewMessage}</p>
            )}
          </Card>
        )}

        <Dialog
          open={showDirectRejectDialog}
          onClose={() => {
            if (submittingDirectReject) return;
            setShowDirectRejectDialog(false);
            setDirectRejectError(null);
          }}
          title="Reject this candidate directly?"
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              This skips manager review entirely and immediately rejects the
              application, sending the candidate a rejection email. This
              cannot be undone.
            </p>
            {directRejectError && (
              <p className="text-sm text-danger">{directRejectError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={submittingDirectReject}
                onClick={() => {
                  setShowDirectRejectDialog(false);
                  setDirectRejectError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={submittingDirectReject}
                onClick={() => void submitDirectReject()}
              >
                {submittingDirectReject ? "Rejecting…" : "Reject Candidate"}
              </Button>
            </div>
          </div>
        </Dialog>

        {canDecide && match && match.applicationStatus === "MANAGER_REVIEWED" && (
          <section className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Decision
            </h2>
            <Card className="mt-2">
              <form onSubmit={submitDecision} className="flex flex-col gap-3">
                <Select
                  value={decision}
                  onChange={(event) => setDecision(event.target.value as Decision)}
                  disabled={submittingDecision}
                >
                  <option value="SELECTED">Selected</option>
                  <option value="NEXT_ROUND">Next Round</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
                {decision === "NEXT_ROUND" && (
                  <>
                    <label className="text-sm text-text-secondary">
                      Next round time
                      <Input
                        required
                        type="datetime-local"
                        value={nextRoundTime}
                        onChange={(event) => setNextRoundTime(event.target.value)}
                        disabled={submittingDecision}
                        className="mt-1"
                      />
                    </label>
                    <label className="text-sm text-text-secondary">
                      Response deadline
                      <Input
                        required
                        type="datetime-local"
                        value={nextRoundDeadline}
                        onChange={(event) => setNextRoundDeadline(event.target.value)}
                        disabled={submittingDecision}
                        className="mt-1"
                      />
                    </label>
                  </>
                )}
                {decisionError && <p className="text-sm text-danger">{decisionError}</p>}
                {decisionMessage && (
                  <p className="text-sm text-success-text">{decisionMessage}</p>
                )}
                <Button type="submit" disabled={submittingDecision} className="self-start">
                  {submittingDecision ? "Submitting…" : "Submit Decision"}
                </Button>
              </form>
            </Card>
          </section>
        )}
        {canDecide && match && match.applicationStatus !== "MANAGER_REVIEWED" && decisionMessage && (
          <section className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Decision
            </h2>
            <Card className="mt-2">
              <p className="text-sm text-success-text">{decisionMessage}</p>
            </Card>
          </section>
        )}

        {canDecide && match && match.applicationStatus === "NEXT_ROUND" && (
          <section className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Next Round
            </h2>
            <Card className="mt-2 flex flex-col gap-2">
              <p className="text-sm text-text-secondary">
                This candidate was advanced to another interview round.
              </p>
              {revertDecisionError && (
                <p className="text-sm text-danger">{revertDecisionError}</p>
              )}
              <Button
                variant="secondary"
                onClick={() => void revertDecision()}
                disabled={revertingDecision}
                className="self-start"
              >
                {revertingDecision ? "Reverting…" : "Change Decision"}
              </Button>
            </Card>
          </section>
        )}

        {canDecide && match && match.applicationStatus === "SELECTED" && (
          <section className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Offer Letter
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              This candidate has been selected. Sending the offer letter marks
              them as hired.
            </p>
            <Card className="mt-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-text-muted">
                  Selected the wrong candidate? You can still change this as
                  long as no offer letter has been sent yet.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void revertDecision()}
                  disabled={revertingDecision}
                  className="shrink-0 px-2.5 py-1 text-xs"
                >
                  {revertingDecision ? "Reverting…" : "Change Decision"}
                </Button>
              </div>
              {revertDecisionError && (
                <p className="mt-2 text-sm text-danger">{revertDecisionError}</p>
              )}
              <form onSubmit={sendOfferLetter} className="mt-3 flex flex-col gap-3">
                <Textarea
                  value={offerDetails}
                  onChange={(event) => setOfferDetails(event.target.value)}
                  placeholder="Optional details to include (start date, compensation, next steps)…"
                  rows={3}
                  maxLength={2000}
                  disabled={sendingOffer}
                />
                {offerError && <p className="text-sm text-danger">{offerError}</p>}
                {offerMessage && (
                  <p className="text-sm text-success-text">{offerMessage}</p>
                )}
                <Button type="submit" disabled={sendingOffer} className="self-start">
                  {sendingOffer ? "Sending…" : "Send Offer Letter"}
                </Button>
              </form>
            </Card>
          </section>
        )}
        {canDecide && match && match.applicationStatus === "HIRED" && offerMessage && (
          <section className="mt-8">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Offer Letter
            </h2>
            <Card className="mt-2">
              <p className="text-sm text-success-text">{offerMessage}</p>
            </Card>
          </section>
        )}
      </div>
    </StaffNav>
  );
}

export default function CandidateDetailPage() {
  return (
    <RoleGuard>
      <CandidateDetail />
    </RoleGuard>
  );
}
