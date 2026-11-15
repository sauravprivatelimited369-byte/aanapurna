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
import type { Locale } from "@/lib/i18n";

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

export function buildMessages(locale: Locale): Messages {
  const or = locale === "or";
  const date = (value: string) => new Intl.DateTimeFormat(or ? "or-IN" : "en-IN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
  }).format(new Date(value));
  return or
    ? {
        heading: "ଆପଣଙ୍କ ଅନୁରୋଧ କେଉଁଠି ଅଛି",
        show: "ସମୟରେଖା ଦେଖନ୍ତୁ",
        hide: "ସମୟରେଖା ଲୁଚାନ୍ତୁ",
        loading: "ଅନୁରୋଧ ଖୋଜୁଛୁ…",
        failed: "ଅନୁରୋଧର ସ୍ଥିତି ପଢ଼ିପାରିଲୁ ନାହିଁ।",
        waited: "ଅପେକ୍ଷା",
        hours: "ଘଣ୍ଟା",
        nextStep: "ପରବର୍ତ୍ତୀ ପଦକ୍ଷେପ",
        queue: (count) => `ଆପଣଙ୍କ ପୂର୍ବରୁ ${count}ଟି ଖୋଲା ଅନୁରୋଧ ଅଛି`,
        noWindow: "କୌଣସି ସମୟସୀମା ଲେଖା ହୋଇନାହିଁ, ତେଣୁ କୌଣସି ତାରିଖର ପ୍ରତିଶ୍ରୁତି ନାହିଁ।",
        window: (h) => `${h} ଘଣ୍ଟା ମଧ୍ୟରେ ଉତ୍ତର ଦେବାକୁ ପ୍ରତିଶ୍ରୁତି`,
        overdue: (h) => `${h} ଘଣ୍ଟାର ସମୟସୀମା ଅତିକ୍ରମ ହୋଇଛି`,
        onTime: "ସମୟସୀମା ଭିତରେ ଅଛି",
        current: "ବର୍ତ୍ତମାନ ଏଠାରେ",
        formatDate: date,
      }
    : {
        heading: "Where your request is",
        show: "Show the timeline",
        hide: "Hide the timeline",
        loading: "Looking up your request…",
        failed: "The status of this request could not be read.",
        waited: "Waiting",
        hours: "hours",
        nextStep: "What happens next",
        queue: (count) => `${count} open requests were submitted before yours`,
        noWindow: "No response window is recorded, so no date is promised.",
        window: (h) => `Promised answer within ${h} hours`,
        overdue: (h) => `Past the ${h}-hour window`,
        onTime: "Inside the window",
        current: "Here now",
        formatDate: date,
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
