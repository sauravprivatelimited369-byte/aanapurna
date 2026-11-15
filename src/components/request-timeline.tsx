"use client";

/**
 * Why this request is still open, and what happens next.
 *
 * A status pill reads `in_review` and stops there. That tells somebody the name of an internal state,
 * not whether anyone has picked the request up, how long it has been waiting, or who is answerable
 * now. This asks the server for the real sequence, which is read from the audit trail rather than
 * inferred from the current status, and renders only what happened.
 *
 * When no response window is recorded it says so, and it does not show the waiting time in a colour
 * that implies a breach. "We do not know" and "we are late" are different facts and the styling keeps
 * them apart.
 */

import { useCallback, useState } from "react";
import type { RequestProgress } from "@/domain/request-progress";
import { formatDate, translator, type Locale } from "@/lib/i18n";

type Progress = RequestProgress & { id: string };

type Messages = {
  heading: string;
  show: string;
  hide: string;
  loading: string;
  failed: string;
  waited: string;
  hours: string;
  nextStep: string;
  queue: (count: number) => string;
  noWindow: string;
  window: (hours: number) => string;
  overdue: (hours: number) => string;
  onTime: string;
  current: string;
  formatDate: (value: string) => string;
};

/**
 * The timeline's copy, from the shared dictionary.
 *
 * This used to carry its own four-language branch, which is how a second copy of the strings appears
 * and then drifts from the first. The dictionary already has every one of these keys in every
 * language, so the component holds no prose of its own — adding a language is a change in one file.
 */
export function buildMessages(locale: Locale): Messages {
  const t = translator(locale);
  return {
    heading: t("request.progress.heading"),
    show: t("request.progress.showTimeline"),
    hide: t("request.progress.hideTimeline"),
    loading: t("request.progress.loading"),
    failed: t("request.progress.failed"),
    waited: t("request.progress.waited"),
    hours: t("request.progress.hours"),
    nextStep: t("request.progress.nextStep"),
    queue: (count) => t("request.progress.queue", { count }),
    noWindow: t("request.progress.noWindow"),
    window: (hours) => t("request.progress.window", { hours }),
    overdue: (hours) => t("request.progress.overdue", { hours }),
    onTime: t("request.progress.onTime"),
    current: t("request.progress.current"),
    formatDate: (value) => formatDate(locale, value),
  };
}

export function RequestTimeline({ requestId, locale }: { requestId: string; locale: Locale }) {
  const m = buildMessages(locale);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/account/requests/${requestId}`, { cache: "no-store" });
      const body = await response.json() as Progress & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? m.failed);
      setProgress(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.failed);
    }
  }, [requestId, m.failed]);


  const tone = progress?.overdue === null || progress === null
    ? "status-pill--submitted"
    : progress.overdue ? "status-pill--rejected" : "status-pill--completed";

  return (
    <div className="request-timeline">
      <button
        className="app-card-link"
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !progress) void load();
        }}
      >
        {open ? m.hide : m.show}
      </button>

      {open && (
        <div className="request-timeline__body">
          {!progress && !error && <p className="muted" role="status">{m.loading}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {progress && (
            <>
              <div className="request-timeline__facts">
                <span className="muted">
                  {m.waited}: <strong>{progress.ageHours}</strong> {m.hours}
                </span>
                <span className={`status-pill ${tone}`}>
                  {progress.overdue === null
                    ? m.noWindow
                    : progress.overdue
                      ? m.overdue(progress.windowHours ?? 0)
                      : m.onTime}
                </span>
                {progress.aheadInQueue !== null && progress.aheadInQueue > 0 && progress.overdue !== false && (
                  <span className="muted">{m.queue(progress.aheadInQueue)}</span>
                )}
              </div>

              <ol className="request-timeline__stages">
                {progress.stages.map((stage) => (
                  <li
                    key={`${stage.key}-${stage.at}`}
                    className={stage.current ? "data-row data-row--stack request-timeline__stage is-current" : "data-row data-row--stack request-timeline__stage"}
                  >
                    <span className="data-main">
                      <strong>{stage.label}</strong>
                      <small>{m.formatDate(stage.at)}</small>
                      {stage.detail && <small className="muted">{stage.detail}</small>}
                    </span>
                    {stage.current && <span className="status-pill status-pill--in_review">{m.current}</span>}
                  </li>
                ))}
              </ol>

              <div className="inline-notice">
                <strong>{m.nextStep}.</strong> {progress.nextStep}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
