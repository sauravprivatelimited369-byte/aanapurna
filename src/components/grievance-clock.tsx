"use client";

/**
 * Overdue complaints.
 *
 * A response window is a measurement, not a promise: it says how long something has waited, not how
 * fast anybody agreed to answer. This card exists so a privacy request or support case that has sat
 * past the recorded window is visible on the operations screen, rather than ageing in a table until
 * the person complains a second time.
 *
 * When no window is recorded it says exactly that. It does not invent a default and it does not show
 * a green tick for a promise nobody made.
 */

import { useCallback, useEffect, useState } from "react";

type Clocks = {
  windowHours: number | null;
  privacyRequests: { open_requests: number; overdue_requests: number; oldest_open_at: string | null; oldest_overdue_hours: number };
  supportCases: { open_cases: number; overdue_cases: number };
};

function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value))
    : "—";
}

export function GrievanceClock() {
  const [clocks, setClocks] = useState<Clocks | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/grievance-clocks", { cache: "no-store" });
    const body = await response.json() as Clocks & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "The complaint clocks could not be loaded.");
    setClocks(body);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "The complaint clocks could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [load]);

  if (error) return <section className="app-card app-card--full"><h2>Overdue complaints</h2><p className="auth-error" role="alert">{error}</p></section>;
  if (!clocks) return <section className="app-card app-card--full"><h2>Overdue complaints</h2><p className="muted">Loading…</p></section>;

  const totalOverdue = clocks.privacyRequests.overdue_requests + clocks.supportCases.overdue_cases;

  return (
    <section className="app-card app-card--full" id="grievance-clocks">
      <div className="app-card-title">
        <div>
          <h2>Overdue complaints</h2>
          <p>
            How long the oldest unanswered privacy request has waited, measured against the response
            window recorded on the register. This is a measurement, not a service level.
          </p>
        </div>
      </div>

      {clocks.windowHours === null ? (
        <div className="inline-notice">
          <strong>No response window is recorded.</strong>{" "}
          Nothing is being measured, so no complaint can be shown as late and none can be shown as
          answered on time. Record a window on the launch-readiness panel to start the clock.
        </div>
      ) : (
        <>
          <p className="muted">
            Window: {clocks.windowHours} hours. {totalOverdue === 0 ? "Nothing is past it." : `${totalOverdue} item(s) are past it.`}
          </p>
          <table>
            <thead>
              <tr><th>Queue</th><th>Open</th><th>Past the window</th><th>Oldest open</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Privacy requests</td>
                <td>{clocks.privacyRequests.open_requests}</td>
                <td>{clocks.privacyRequests.overdue_requests}</td>
                <td>{formatDate(clocks.privacyRequests.oldest_open_at)}</td>
              </tr>
              <tr>
                <td>Support cases</td>
                <td>{clocks.supportCases.open_cases}</td>
                <td>{clocks.supportCases.overdue_cases}</td>
                <td className="muted">see the support queue</td>
              </tr>
            </tbody>
          </table>
          {clocks.privacyRequests.oldest_overdue_hours > 0 ? (
            <p className="auth-error" role="alert">
              The oldest overdue privacy request has waited {clocks.privacyRequests.oldest_overdue_hours} hours past the window.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
