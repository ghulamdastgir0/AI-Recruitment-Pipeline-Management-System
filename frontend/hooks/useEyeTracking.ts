"use client";

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useCallback, useRef, useState } from "react";
import { estimateGaze, GazeDirection, GazeEstimate } from "@/lib/monitoring/eyeTracking";
import { ViolationType } from "@/lib/monitoring/violationTypes";

// Slightly loosened from 5s — same rationale as the other proctoring
// thresholds (see useInterviewMonitoring.ts): more tolerance for a brief
// glance away before it counts as a sustained look-away.
const DIRECTION_HOLD_MS = 6_000;

// "Shifty eyes" detector: repeatedly flicking gaze away and back (e.g.
// reading notes off-screen in quick glances) never holds long enough to
// trip DIRECTION_HOLD_MS on its own, so it needs its own signal based on
// how often/how long the direction keeps changing within a rolling window.
const RAPID_SWITCH_WINDOW_MS = 12_000;
// "More than 10 direction changes within 12 seconds."
const RAPID_SWITCH_COUNT_THRESHOLD = 10;
// "Repeatedly alternates between CENTER and the same direction for several
// seconds" — a sustained back-and-forth pattern, even if too slow to trip
// the count threshold above.
const ALTERNATION_MIN_COUNT = 5;
const ALTERNATION_MIN_DURATION_MS = 7_000;
// Once fired, require a fresh count/pattern (not just one more flicker)
// before firing again.
const RAPID_SWITCH_COOLDOWN_MS = 12_000;

export interface EyeTrackingState {
  direction: GazeDirection;
  eyesClosed: boolean;
  /** Seconds the current non-center/closed condition has been continuously held. */
  lookingAwayDuration: number;
  blinkCount: number;
  /** Not part of the spec'd EyeTrackingState, but needed to render the pause indicator. */
  faceDetected: boolean;
}

type ReportFn = (type: ViolationType, metadata?: Record<string, unknown>) => unknown;

type Condition = GazeDirection | "EYES_CLOSED";
/** Condition excluding "CENTER" — the only values an active (non-resting) episode can hold. */
type ActiveCondition = Exclude<Condition, "CENTER">;

const CONDITION_VIOLATION: Record<ActiveCondition, ViolationType> = {
  LEFT: "LOOKING_LEFT",
  RIGHT: "LOOKING_RIGHT",
  UP: "LOOKING_UP",
  DOWN: "LOOKING_DOWN",
  EYES_CLOSED: "EYES_CLOSED_TOO_LONG",
};

const INITIAL_STATE: EyeTrackingState = {
  direction: "CENTER",
  eyesClosed: false,
  lookingAwayDuration: 0,
  blinkCount: 0,
  faceDetected: false,
};

/** Mutable per-episode bookkeeping, kept in a ref so ticks don't re-render unless the derived state actually changes. */
interface EpisodeRefs {
  condition: ActiveCondition | null;
  since: number | null;
  fired: boolean;
  blinkCount: number;
}

function nextConditionFor(gaze: GazeEstimate): ActiveCondition | null {
  if (gaze.eyesClosed) return "EYES_CLOSED";
  return gaze.direction === "CENTER" ? null : gaze.direction;
}

function statesEqual(a: EyeTrackingState, b: EyeTrackingState): boolean {
  return (
    a.direction === b.direction &&
    a.eyesClosed === b.eyesClosed &&
    a.lookingAwayDuration === b.lookingAwayDuration &&
    a.blinkCount === b.blinkCount &&
    a.faceDetected === b.faceDetected
  );
}

/**
 * Advances the episode state machine by one detection tick and returns the
 * resulting EyeTrackingState. A "condition" (LEFT/RIGHT/UP/DOWN/EYES_CLOSED)
 * must hold continuously for DIRECTION_HOLD_MS before firing one warning via
 * `report`; it resets the instant gaze returns to center or eyes reopen. A
 * blink is exactly an EYES_CLOSED episode that ends before ever reaching
 * that threshold. Mirrors the faceMissingSince/faceMissingFired pattern
 * already used for FACE_MISSING/LOOKING_AWAY in useInterviewMonitoring.ts.
 */
function advanceEpisode(
  refs: EpisodeRefs,
  gaze: GazeEstimate,
  now: number,
  report: ReportFn,
): EyeTrackingState {
  const nextCondition = nextConditionFor(gaze);

  if (nextCondition !== refs.condition) {
    if (refs.condition === "EYES_CLOSED" && !refs.fired) {
      refs.blinkCount += 1;
    }
    refs.condition = nextCondition;
    refs.since = now;
    refs.fired = false;
  }

  let elapsedSeconds = 0;
  if (nextCondition !== null && refs.since !== null) {
    const elapsedMs = now - refs.since;
    elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (!refs.fired && elapsedMs >= DIRECTION_HOLD_MS) {
      refs.fired = true;
      report(CONDITION_VIOLATION[nextCondition], {
        direction: nextCondition === "EYES_CLOSED" ? undefined : nextCondition,
        durationSeconds: Math.round(elapsedMs / 1000),
      });
    }
  }

  return {
    direction: nextCondition === "EYES_CLOSED" || nextCondition === null ? "CENTER" : nextCondition,
    eyesClosed: nextCondition === "EYES_CLOSED",
    lookingAwayDuration: elapsedSeconds,
    blinkCount: refs.blinkCount,
    faceDetected: true,
  };
}

interface GazeTransition {
  direction: GazeDirection;
  at: number;
}

/** Rolling buffer of recent CENTER/LEFT/RIGHT/UP/DOWN transitions (EYES_CLOSED excluded — this tracks gaze flicking, not blinking). */
interface RapidSwitchRefs {
  transitions: GazeTransition[];
  lastFiredAt: number;
}

function pruneOldTransitions(transitions: GazeTransition[], now: number): void {
  while (transitions.length > 0 && now - transitions[0].at > RAPID_SWITCH_WINDOW_MS) {
    transitions.shift();
  }
}

/** True if every non-center entry in the window is the same direction and the pattern has spanned at least ALTERNATION_MIN_DURATION_MS — a sustained CENTER<->X<->CENTER<->X... flicker even if too slow to trip the count threshold. */
function isSustainedAlternation(transitions: GazeTransition[]): boolean {
  if (transitions.length < ALTERNATION_MIN_COUNT) return false;
  const nonCenterDirections = new Set(
    transitions.filter((t) => t.direction !== "CENTER").map((t) => t.direction),
  );
  if (nonCenterDirections.size !== 1) return false;
  const span = transitions[transitions.length - 1].at - transitions[0].at;
  return span >= ALTERNATION_MIN_DURATION_MS;
}

function trackRapidGazeSwitching(
  refs: RapidSwitchRefs,
  nextDirection: GazeDirection,
  now: number,
  report: ReportFn,
): void {
  refs.transitions.push({ direction: nextDirection, at: now });
  pruneOldTransitions(refs.transitions, now);

  if (now - refs.lastFiredAt < RAPID_SWITCH_COOLDOWN_MS) return;

  const tooFrequent = refs.transitions.length > RAPID_SWITCH_COUNT_THRESHOLD;
  const sustainedAlternation = isSustainedAlternation(refs.transitions);
  if (!tooFrequent && !sustainedAlternation) return;

  refs.lastFiredAt = now;
  report("RAPID_GAZE_SWITCHING", {
    switchCount: refs.transitions.length,
    windowSeconds: Math.round(RAPID_SWITCH_WINDOW_MS / 1000),
    reason: tooFrequent ? "high_frequency" : "sustained_alternation",
  });
  refs.transitions = [];
}

export interface EyeTrackingHandle {
  state: EyeTrackingState;
  /** Feed one detection tick's landmarks in — called from the existing face-detect loop, not a separate one. */
  processFrame: (landmarks: NormalizedLandmark[] | null, now: number) => void;
}

/**
 * Tracks gaze direction and eye closure. No face detection, no camera
 * access, no interval of its own — this is a pure consumer of whatever
 * landmarks the shared face-tracking loop passes in via processFrame(), and
 * reports through the same `report` callback (and therefore the same shared
 * warning counter) as every other proctoring rule.
 */
export function useEyeTracking(report: ReportFn, active: boolean): EyeTrackingHandle {
  const [state, setState] = useState<EyeTrackingState>(INITIAL_STATE);
  const refs = useRef<EpisodeRefs>({ condition: null, since: null, fired: false, blinkCount: 0 });
  const rapidSwitchRefs = useRef<RapidSwitchRefs>({ transitions: [], lastFiredAt: 0 });

  const processFrame = useCallback(
    (landmarks: NormalizedLandmark[] | null, now: number) => {
      if (!active) return;

      if (!landmarks) {
        // No face — pause. Drop any in-progress episode rather than let it
        // silently resume with stale elapsed time once the face returns.
        refs.current.condition = null;
        refs.current.since = null;
        refs.current.fired = false;
        rapidSwitchRefs.current.transitions = [];
        setState((prev) =>
          prev.faceDetected ? { ...INITIAL_STATE, blinkCount: prev.blinkCount } : prev,
        );
        return;
      }

      const gaze = estimateGaze(landmarks);
      if (!gaze) return;

      const previousCondition = refs.current.condition;
      const nextCondition = nextConditionFor(gaze);
      const next = advanceEpisode(refs.current, gaze, now, report);

      // Only count pure gaze-direction flips (CENTER/LEFT/RIGHT/UP/DOWN) —
      // a transition into/out of EYES_CLOSED is blinking, not flicking
      // between directions, and is tracked separately as blinkCount.
      if (
        nextCondition !== previousCondition &&
        nextCondition !== "EYES_CLOSED" &&
        previousCondition !== "EYES_CLOSED"
      ) {
        const nextDirection: GazeDirection = nextCondition === null ? "CENTER" : nextCondition;
        trackRapidGazeSwitching(rapidSwitchRefs.current, nextDirection, now, report);
      }
      setState((prev) => (statesEqual(prev, next) ? prev : next));
    },
    [active, report],
  );

  return { state, processFrame };
}
