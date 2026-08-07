"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { startBrowserMonitor } from "@/lib/monitoring/browserMonitor";
import { createFaceLandmarker, detectFacePose } from "@/lib/monitoring/faceTracking";
import { enterFullscreen, startFullscreenMonitor } from "@/lib/monitoring/fullscreenManager";
import { createPhoneDetector, detectPhone } from "@/lib/monitoring/objectDetection";
import { registerUnloadBeacon } from "@/lib/monitoring/unloadHandler";
import { WarningManager } from "@/lib/monitoring/warningManager";
import { ViolationSummary, ViolationType } from "@/lib/monitoring/violationTypes";
import { useEyeTracking, EyeTrackingState } from "@/hooks/useEyeTracking";

// Slightly loosened from the original 5s/10s/0.35rad/10s — real usage showed
// these firing on brief, ordinary movement (glancing down to type, a quick
// stretch) rather than actual attempts to cheat. Still tight enough to catch
// a sustained absence/away-glance/second person, just with a bit more
// tolerance before a warning fires.
const FACE_MISSING_MS = 7_000;
const LOOKING_AWAY_MS = 12_000;
const LOOKING_AWAY_RADIANS = 0.4; // ~23 degrees — coarse "away from screen" threshold
const MOBILE_CONSECUTIVE_FRAMES = 3;
const MULTIPLE_FACES_COOLDOWN_MS = 12_000;
// Originally bumped from 500ms to 80ms (~12Hz) to chase the "10-15 FPS"
// spec target for eye tracking, but detectForVideo() runs synchronously on
// the main thread — at that rate it started starving the socket/audio
// pipeline on real hardware (reports of the 20s answer-submit timeout
// tripping). 200ms (5Hz) is a large step down from that, but still 10x
// finer than the 5-second gaze-hold thresholds need, and leaves the main
// thread free the other 95%+ of the time for everything else the interview
// page is doing.
const FACE_DETECT_INTERVAL_MS = 200; // 5 Hz
const PHONE_DETECT_INTERVAL_MS = 1_000; // 1 Hz

export interface MonitoringToast {
  id: number;
  message: string;
}

export interface InterviewMonitoringState {
  warningTotal: number;
  fullscreenLost: boolean;
  toast: MonitoringToast | null;
  dismissToast: () => void;
  forcedSubmission: boolean;
  requestFullscreenAgain: () => void;
  eyeTracking: EyeTrackingState;
  /** False until the face/eye detection models have finished loading — lets the UI show "starting up" instead of a misleading "no face detected". */
  modelsReady: boolean;
}

/**
 * Orchestrates the whole proctoring layer for one interview session: face
 * tracking + phone detection (throttled polls against the camera video
 * element), tab-switch/blur/shortcut monitoring, fullscreen enforcement,
 * and a browser-close safety net — all funneled through one WarningManager
 * so the 5-warning cap and forced-submission signal are consistent
 * regardless of which rule tripped it.
 *
 * `active` gates every listener/loop — the interview page only flips it on
 * once the candidate has actually joined and the camera stream is live, and
 * everything here tears down cleanly the moment it flips back off (forced
 * submission, or unmount).
 */
export function useInterviewMonitoring(
  applicationId: string,
  videoEl: HTMLVideoElement | null,
  active: boolean,
): InterviewMonitoringState {
  const [warningTotal, setWarningTotal] = useState(0);
  const [fullscreenLost, setFullscreenLost] = useState(false);
  const [toast, setToast] = useState<MonitoringToast | null>(null);
  const [forcedSubmission, setForcedSubmission] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);

  const manager = useMemo(() => new WarningManager(applicationId), [applicationId]);
  const toastIdRef = useRef(0);
  const stoppedRef = useRef(false);

  const report = useCallback(
    async (type: ViolationType, metadata?: Record<string, unknown>) => {
      if (stoppedRef.current) return;
      const result = await manager.report(type, metadata);
      if (!result) return;
      setWarningTotal(manager.total);
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, message: result.message });
      if (result.forced) {
        stoppedRef.current = true;
        setForcedSubmission(true);
      }
    },
    [manager],
  );

  // Same shared `report` (and therefore the same warning counter/cap) as
  // every other proctoring rule — eye tracking doesn't own its own counter.
  const eyeTracking = useEyeTracking(report, active);

  const dismissToast = useCallback(() => setToast(null), []);

  const requestFullscreenAgain = useCallback(() => {
    enterFullscreen().then((ok) => {
      if (ok) setFullscreenLost(false);
    });
  }, []);

  // Rehydrate the warning count on mount — a page refresh resumes an
  // in-progress interview (the question/answer state already survives via
  // the backend), this restores the warning badge to match.
  useEffect(() => {
    let cancelled = false;
    apiFetch<ViolationSummary>(`/interview-sessions/${applicationId}/violations`)
      .then((summary) => {
        if (cancelled) return;
        manager.hydrate(summary);
        setWarningTotal(summary.total);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applicationId, manager]);

  useEffect(() => {
    if (!active) return;
    return startBrowserMonitor({
      onTabSwitch: () => void report("TAB_SWITCH"),
      onWindowBlur: () => void report("WINDOW_BLUR"),
      onShortcutAttempted: (combo) => void report("SHORTCUT_ATTEMPTED", { combo }),
    });
  }, [active, report]);

  useEffect(() => {
    if (!active) return;
    enterFullscreen();
    return startFullscreenMonitor(() => {
      setFullscreenLost(true);
      void report("FULLSCREEN_EXIT");
      requestFullscreenAgain();
    });
  }, [active, report, requestFullscreenAgain]);

  useEffect(() => {
    if (!active) return;
    return registerUnloadBeacon(applicationId);
  }, [active, applicationId]);

  // Face tracking + phone detection loops. Both throttled on the main
  // thread rather than a Web Worker — MediaPipe/TFJS already offload the
  // actual inference to WASM/WebGL, so a dedicated worker (which would need
  // video-frame transfer via OffscreenCanvas) adds real complexity for
  // little gain at 1-2 polls/sec.
  useEffect(() => {
    if (!active || !videoEl) return;
    setModelsReady(false);
    let cancelled = false;
    let faceInterval: ReturnType<typeof setInterval> | null = null;
    let phoneInterval: ReturnType<typeof setInterval> | null = null;

    let faceMissingSince: number | null = null;
    let faceMissingFired = false;
    let lookingAwaySince: number | null = null;
    let lookingAwayFired = false;
    let lastMultipleFacesWarnAt = 0;
    let consecutivePhoneFrames = 0;
    let phoneEpisodeFired = false;

    void (async () => {
      // Logged rather than silently swallowed — a failed model load (e.g.
      // network/CORS trouble reaching the CDN-hosted weights) otherwise
      // looks identical to "detection just isn't firing" with zero trace of
      // why in devtools.
      const [landmarker, phoneDetector] = await Promise.all([
        createFaceLandmarker().catch((err: unknown) => {
          console.error("[interview-monitoring] Face landmarker failed to load", err);
          return null;
        }),
        createPhoneDetector().catch((err: unknown) => {
          console.error("[interview-monitoring] Phone detector failed to load", err);
          return null;
        }),
      ]);
      if (cancelled) return;
      setModelsReady(true);

      if (landmarker) {
        faceInterval = setInterval(() => {
          if (!videoEl || videoEl.readyState < 2) return;
          const { faceCount, yaw, pitch, landmarks } = detectFacePose(
            landmarker,
            videoEl,
            performance.now(),
          );
          const now = Date.now();

          // Eye tracking rides this same detection pass (no second
          // detectForVideo() call, no second camera stream) — paused
          // automatically whenever no face is present (landmarks null).
          eyeTracking.processFrame(faceCount === 0 ? null : landmarks, now);

          if (faceCount === 0) {
            faceMissingSince ??= now;
            if (!faceMissingFired && now - faceMissingSince >= FACE_MISSING_MS) {
              faceMissingFired = true;
              void report("FACE_MISSING");
            }
          } else {
            faceMissingSince = null;
            faceMissingFired = false;
          }

          if (
            faceCount > 1 &&
            now - lastMultipleFacesWarnAt >= MULTIPLE_FACES_COOLDOWN_MS
          ) {
            lastMultipleFacesWarnAt = now;
            void report("MULTIPLE_FACES");
          }

          const lookingAway =
            Math.abs(yaw) > LOOKING_AWAY_RADIANS ||
            Math.abs(pitch) > LOOKING_AWAY_RADIANS;
          if (faceCount === 1 && lookingAway) {
            lookingAwaySince ??= now;
            if (!lookingAwayFired && now - lookingAwaySince >= LOOKING_AWAY_MS) {
              lookingAwayFired = true;
              void report("LOOKING_AWAY");
            }
          } else {
            lookingAwaySince = null;
            lookingAwayFired = false;
          }
        }, FACE_DETECT_INTERVAL_MS);
      }

      if (phoneDetector) {
        let phoneCheckInFlight = false;

        // async/await instead of a .then/.catch/.finally chain here — that
        // chain nested 3 more function levels inside this IIFE's setInterval
        // callback (already 4 deep), tripping a max-nesting-depth lint rule
        // for no functional reason; a linear await body doesn't add any.
        const runPhoneCheck = async () => {
          phoneCheckInFlight = true;
          try {
            const seen = await detectPhone(phoneDetector, videoEl);
            if (seen) {
              consecutivePhoneFrames += 1;
              if (
                !phoneEpisodeFired &&
                consecutivePhoneFrames >= MOBILE_CONSECUTIVE_FRAMES
              ) {
                phoneEpisodeFired = true;
                void report("MOBILE_DETECTED");
              }
            } else {
              consecutivePhoneFrames = 0;
              phoneEpisodeFired = false;
            }
          } catch (err) {
            console.error("[interview-monitoring] Phone detection tick failed", err);
          } finally {
            phoneCheckInFlight = false;
          }
        };

        phoneInterval = setInterval(() => {
          // Guards against overlapping calls if one inference runs long —
          // without this, a slow tick could pile up concurrent detect()
          // calls faster than they resolve.
          if (phoneCheckInFlight || !videoEl || videoEl.readyState < 2) return;
          void runPhoneCheck();
        }, PHONE_DETECT_INTERVAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (faceInterval) clearInterval(faceInterval);
      if (phoneInterval) clearInterval(phoneInterval);
    };
    // eyeTracking.processFrame is itself memoized on [active, report], both
    // already deps here — depending on the whole `eyeTracking` object would
    // re-run this effect (and reload the FaceLandmarker) on every eye-state
    // change, since useEyeTracking returns a fresh object each render.
  }, [active, videoEl, report, eyeTracking.processFrame]);

  return {
    warningTotal,
    fullscreenLost,
    toast,
    dismissToast,
    forcedSubmission,
    requestFullscreenAgain,
    eyeTracking: eyeTracking.state,
    modelsReady,
  };
}
