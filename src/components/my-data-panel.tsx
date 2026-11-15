"use client";

/**
 * Your data.
 *
 * The page a person lands on when they ask "what do you have about me, and can I get it out?".
 * It offers the two things they are actually entitled to: a copy of their data, and the correction of
 * the one field that is theirs to change.
 *
 * It does not offer a delete button. Erasure is a reviewed request, because it destroys credentials
 * and evidence of what happened to food, and a single mis-tap should not be able to do that. The panel
 * says so plainly rather than hiding the option and letting people assume it does not exist.
 */

import { FormEvent, useState } from "react";

type ExportState = { kind: "idle" } | { kind: "ready"; filename: string; document: unknown; size: number } | { kind: "error"; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MyDataPanel({ currentDisplayName }: { currentDisplayName: string | null }) {
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState(currentDisplayName ?? "");

  async function requestExport() {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/export", { cache: "no-store" });
      const body = await response.json() as { document?: unknown; filename?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The export could not be produced.");
      const serialised = JSON.stringify(body.document, null, 2);
      setExportState({
        kind: "ready",
        filename: body.filename ?? "annapurna-link-data-export.json",
        document: body.document,
        size: new Blob([serialised]).size,
      });
      setMessage("Your export is ready. Downloading does not delete anything.");
    } catch (caught) {
      setExportState({ kind: "error", message: caught instanceof Error ? caught.message : "The export could not be produced." });
    } finally {
      setBusy("");
    }
  }

  function download() {
    if (exportState.kind !== "ready") return;
    const blob = new Blob([JSON.stringify(exportState.document, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportState.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Downloaded. This is a personal copy — store it somewhere you would not mind it being read.");
  }

  function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("name");
    setError("");
    setMessage("");
    void (async () => {
      try {
        const response = await fetch("/api/account/display-name", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        });
        const body = await response.json() as { displayName?: string; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "The change could not be saved.");
        setMessage("Your display name was updated and the change was recorded in the audit trail.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The change could not be saved.");
      } finally {
        setBusy("");
      }
    })();
  }

  return (
    <section className="app-card app-card--full" id="your-data">
      <div className="app-card-title">
        <div>
          <h2>Your data</h2>
          <p>
            Take a copy of everything this service holds about your account, or correct the one field
            that is yours to change. Both actions are recorded.
          </p>
        </div>
      </div>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {message ? <div className="inline-notice" role="status"><p>{message}</p></div> : null}

      <div className="app-grid">
        <div className="app-card app-card--span-6">
          <h3>Get a copy of your data</h3>
          <p className="muted">
            One JSON file: your account, profile, memberships, notifications, donations you created,
            custody events, receipts you signed, support and privacy requests, and the retention
            actions that ran against your data. Generated on request — nothing is stored on our side.
          </p>
          <div className="row">
            <button type="button" className="button button--primary" onClick={requestExport} disabled={busy === "export"}>
              {busy === "export" ? "Preparing…" : "Produce my export"}
            </button>
            {exportState.kind === "ready" ? (
              <button type="button" className="button button--secondary" onClick={download}>
                Download ({formatBytes(exportState.size)})
              </button>
            ) : null}
          </div>
          {exportState.kind === "ready" ? (
            <p className="muted" style={{ marginTop: 10 }}>
              Your export is held in this browser tab only. Reloading discards it, so download it
              before you navigate away.
            </p>
          ) : null}
          {exportState.kind === "error" ? <p className="auth-error" role="alert">{exportState.message}</p> : null}
        </div>

        <div className="app-card app-card--span-6">
          <h3>Correct your display name</h3>
          <p className="muted">
            This is the name shown to the people you work with. Changing it is recorded with your name
            and the time against it.
          </p>
          <form className="form-stack" onSubmit={saveDisplayName}>
            <div className="form-field">
              <label htmlFor="display-name">Display name</label>
              <input
                className="form-control"
                id="display-name"
                name="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                required
              />
            </div>
            <button className="button button--secondary" type="submit" disabled={busy === "name" || displayName.trim().length === 0}>
              {busy === "name" ? "Saving…" : "Save display name"}
            </button>
          </form>
          <p className="muted" style={{ marginTop: 10 }}>
            Everything else — your email, a partner&apos;s phone number, an organisation&apos;s registered
            name, a verification status — is a record other people act on. Raise those through a
            privacy request so the change is reviewed and attributable.
          </p>
        </div>
      </div>

      <div className="inline-notice" style={{ marginTop: 14 }}>
        <strong>Asking to be erased.</strong> Erasure is a reviewed request, not a button, because it
        ends your sign-in methods and cannot be undone. File it under{" "}
        <a href="/app/support">Support &amp; privacy</a> and choose <em>erasure</em>. Your receipts and
        the audit trail of what happened to food are kept — erasure removes you, not the record that
        somebody delivered it.
      </div>
    </section>
  );
}
