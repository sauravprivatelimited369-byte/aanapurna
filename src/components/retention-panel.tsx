"use client";

/**
 * Records and retention.
 *
 * The privacy page promised a retention window long before anything enforced one. This panel is the
 * control surface for the process that now does: it shows the windows, previews what a sweep would
 * delete or scrub, runs it, and lets a named member of staff put a record on legal hold.
 *
 * The preview is produced by the same database function that performs the sweep, so the number a
 * person approves here is the number that is acted on. That is the whole reason this panel exists
 * rather than a cron job nobody can see.
 */

import { FormEvent, useCallback, useEffect, useState } from "react";

type Settings = {
  notificationsDays: number;
  otpDays: number;
  deliveryCodesDays: number;
  closedIncidentsDays: number;
  failedJobsDays: number;
  auditYears: number;
};

type RunCategory = { category: string; action: string; affectedRows: number; skippedByHold: number };
type RunRecord = { runId: string; executedAt: string; dryRun: boolean; categories: RunCategory[] };

type Status = {
  settings: Settings;
  updatedAt: string | null;
  updatedBy: string | null;
  activeHolds: number;
  lastRuns: RunRecord[];
};

type Hold = {
  id: string;
  scopeType: string;
  userId: string | null;
  organizationId: string | null;
  deliveryJobId: string | null;
  donationId: string | null;
  reason: string;
  placedBy: string;
  placedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
};

type SweepResult = {
  dryRun: boolean;
  results: RunCategory[];
  totalAffected: number;
  totalHeld: number;
};

const windows: Array<{ key: keyof Settings; label: string; hint: string; unit: string }> = [
  { key: "notificationsDays", label: "Read notifications", hint: "Activity copies nobody is reading", unit: "days" },
  { key: "otpDays", label: "Spent one-time codes", hint: "Single-use sign-in codes after expiry", unit: "days" },
  { key: "deliveryCodesDays", label: "Delivery codes", hint: "Expired collection ciphertext", unit: "days" },
  { key: "closedIncidentsDays", label: "Closed incidents", hint: "Free text is scrubbed, the record is kept", unit: "days" },
  { key: "failedJobsDays", label: "Failed emails", hint: "Dead letters that exhausted their retries", unit: "days" },
  { key: "auditYears", label: "Audit detail", hint: "Free text only; who did what is never removed", unit: "years" },
];

function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value))
    : "—";
}

function scopeLabel(hold: Hold): string {
  const subject = hold.userId ?? hold.organizationId ?? hold.deliveryJobId ?? hold.donationId ?? "unknown";
  return `${hold.scopeType} · ${subject.slice(0, 8)}`;
}

export function RetentionPanel({ canWrite, canErase }: { canWrite: boolean; canErase: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<SweepResult | null>(null);

  const load = useCallback(async () => {
    const [statusResponse, holdResponse] = await Promise.all([
      fetch("/api/admin/retention", { cache: "no-store" }),
      fetch("/api/admin/retention/holds", { cache: "no-store" }),
    ]);
    const statusBody = await statusResponse.json() as Status & { error?: { message?: string } };
    if (!statusResponse.ok) throw new Error(statusBody.error?.message ?? "Retention settings could not be loaded.");
    setStatus(statusBody);
    if (holdResponse.ok) {
      const holdBody = await holdResponse.json() as { holds?: Hold[] };
      setHolds(holdBody.holds ?? []);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Retention settings could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [load]);

  async function send(endpoint: string, body: unknown, method = "POST"): Promise<unknown> {
    setError("");
    setMessage("");
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "The change could not be saved.");
    return result;
  }

  function saveWindows(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: Partial<Settings> = {};
    for (const window of windows) {
      const value = Number(form.get(window.key));
      if (Number.isFinite(value)) next[window.key] = value;
    }
    setBusy("settings");
    void (async () => {
      try {
        await send("/api/admin/retention", next, "PATCH");
        setMessage("The retention windows were updated. The next sweep obeys the new numbers.");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The change could not be saved.");
      } finally {
        setBusy("");
      }
    })();
  }

  function runSweep(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "run");
    setError("");
    setMessage("");
    void (async () => {
      try {
        const result = await send("/api/admin/retention", { dryRun }) as SweepResult;
        setPreview(result);
        if (dryRun) {
          setMessage(result.totalAffected === 0
            ? "Nothing is past its retention window."
            : `A real run would affect ${result.totalAffected} row(s). Nothing has been changed yet.`);
        } else {
          setMessage(`Swept. ${result.totalAffected} row(s) deleted or scrubbed, ${result.totalHeld} kept under an active hold.`);
          await load();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The sweep could not run.");
      } finally {
        setBusy("");
      }
    })();
  }

  function placeHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      scopeType: String(form.get("scopeType") ?? ""),
      subjectId: String(form.get("subjectId") ?? "").trim(),
      reason: String(form.get("reason") ?? "").trim(),
    };
    setBusy("hold");
    void (async () => {
      try {
        await send("/api/admin/retention/holds", payload);
        setMessage("The hold is in place. Nothing covered by it will be deleted until it is released.");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The hold could not be placed.");
      } finally {
        setBusy("");
      }
    })();
  }

  function releaseHold(id: string) {
    const reason = window.prompt("Why is this hold no longer needed? (at least 10 characters)");
    if (!reason) return;
    setBusy(id);
    void (async () => {
      try {
        await send(`/api/admin/retention/holds/${id}`, { reason }, "DELETE");
        setMessage("The hold was released. Its history is kept.");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The hold could not be released.");
      } finally {
        setBusy("");
      }
    })();
  }

  function erase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("eraseUserId") ?? "").trim();
    const reason = String(form.get("eraseReason") ?? "").trim();
    if (!window.confirm(`Erase ${userId}? This overwrites the person's name, email and credentials and cannot be undone. Their receipts and the audit trail are kept.`)) return;
    setBusy("erase");
    void (async () => {
      try {
        await send("/api/admin/retention/erase", { userId, reason });
        setMessage("The person was redacted. Their accountability records remain.");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The erasure could not be completed.");
      } finally {
        setBusy("");
      }
    })();
  }

  if (!status) {
    return (
      <section className="panel">
        <h3>Records &amp; retention</h3>
        <p className="muted">{error || "Loading the retention windows…"}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h3>Records &amp; retention</h3>
      <p className="muted">
        The windows below are enforced nightly at 03:15 IST. A preview runs the same code as the sweep,
        so the counts you approve are the counts that are acted on. Nothing inside an active legal hold
        is deleted, whatever the window says.
      </p>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="muted" role="status">{message}</p> : null}

      <form onSubmit={saveWindows} className="stack">
        <table>
          <thead>
            <tr><th>What</th><th>Window</th><th>Why this one</th></tr>
          </thead>
          <tbody>
            {windows.map((window) => (
              <tr key={window.key}>
                <td>{window.label}</td>
                <td>
                  <input
                    type="number"
                    name={window.key}
                    defaultValue={status.settings[window.key]}
                    min={1}
                    disabled={!canWrite || busy === "settings"}
                    aria-label={`${window.label} in ${window.unit}`}
                  />{" "}
                  <span className="muted">{window.unit}</span>
                </td>
                <td className="muted">{window.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canWrite ? (
          <div className="row">
            <button type="submit" disabled={busy === "settings"}>Save windows</button>
            <span className="muted">
              {status.updatedAt ? `Last changed ${formatDate(status.updatedAt)}` : "Never changed since installation"}
            </span>
          </div>
        ) : (
          <p className="muted">Only operations and security administrators can change a window.</p>
        )}
      </form>

      <h4>Sweep</h4>
      <p className="muted">
        {status.activeHolds === 0
          ? "No legal holds are active."
          : `${status.activeHolds} active legal hold(s). Held records are counted as skipped, never deleted.`}
      </p>
      {canWrite ? (
        <div className="row">
          <button type="button" onClick={() => runSweep(true)} disabled={busy === "preview" || busy === "run"}>
            Preview (changes nothing)
          </button>
          <button type="button" onClick={() => runSweep(false)} disabled={busy === "preview" || busy === "run"}>
            Run the sweep now
          </button>
        </div>
      ) : null}

      {preview ? (
        <table>
          <thead>
            <tr><th>Category</th><th>Action</th><th>{preview.dryRun ? "Would affect" : "Affected"}</th><th>Skipped under hold</th></tr>
          </thead>
          <tbody>
            {preview.results.map((row) => (
              <tr key={row.category}>
                <td>{row.category.replaceAll("_", " ")}</td>
                <td>{row.action}</td>
                <td>{row.affectedRows}</td>
                <td>{row.skippedByHold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {status.lastRuns.length > 0 ? (
        <>
          <h4>Recent sweeps</h4>
          <table>
            <thead>
              <tr><th>When</th><th>Kind</th><th>Affected</th><th>Kept under hold</th></tr>
            </thead>
            <tbody>
              {status.lastRuns.map((run) => (
                <tr key={run.runId}>
                  <td>{formatDate(run.executedAt)}</td>
                  <td>{run.dryRun ? "preview" : "applied"}</td>
                  <td>{run.categories.reduce((sum, row) => sum + row.affectedRows, 0)}</td>
                  <td>{run.categories.reduce((sum, row) => sum + row.skippedByHold, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h4>Legal holds</h4>
      <p className="muted">
        A hold is the only thing that outranks a retention window. It is placed and released by a named
        member of staff with a reason, and the history is kept after release.
      </p>
      {holds.length === 0 ? (
        <p className="muted">No holds are active.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Scope</th><th>Reason</th><th>Placed</th><th /></tr>
          </thead>
          <tbody>
            {holds.map((hold) => (
              <tr key={hold.id}>
                <td>{scopeLabel(hold)}</td>
                <td>{hold.reason}</td>
                <td>{formatDate(hold.placedAt)}</td>
                <td>
                  {canWrite ? (
                    <button type="button" onClick={() => releaseHold(hold.id)} disabled={busy === hold.id}>
                      Release
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite ? (
        <form onSubmit={placeHold} className="stack">
          <div className="row">
            <select name="scopeType" defaultValue="user" aria-label="Hold scope">
              <option value="user">Person</option>
              <option value="organization">Organisation</option>
              <option value="job">Delivery job</option>
              <option value="donation">Donation</option>
            </select>
            <input name="subjectId" placeholder="Record ID this hold covers" required aria-label="Record ID" />
          </div>
          <textarea name="reason" placeholder="Why is this record on hold? (at least 10 characters)" required aria-label="Hold reason" />
          <button type="submit" disabled={busy === "hold"}>Place hold</button>
        </form>
      ) : null}

      {canErase ? (
        <>
          <h4>Erasure request</h4>
          <p className="muted">
            This overwrites the person&apos;s name, email and credentials and deletes their sign-in methods.
            It keeps their receipts, custody records and the audit trail, because those answer for what
            happened to the food. It cannot be undone.
          </p>
          <form onSubmit={erase} className="stack">
            <input name="eraseUserId" placeholder="User ID to erase" required aria-label="User ID to erase" />
            <textarea name="eraseReason" placeholder="Request reference and who authorised it (at least 10 characters)" required aria-label="Erasure reason" />
            <button type="submit" disabled={busy === "erase"}>Erase this person</button>
          </form>
        </>
      ) : null}
    </section>
  );
}
