"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Second-factor enrolment for privileged accounts.
 *
 * The secret and the backup codes are returned once, by Better Auth, directly to
 * this component. They are never written to the application database by
 * application code, never logged, and never re-fetchable afterwards.
 */
export function TwoFactorPanel({
  enabled,
  requiredForRole,
}: {
  enabled: boolean;
  requiredForRole: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const secret = (() => {
    if (!totpUri) return "";
    try {
      return new URL(totpUri).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  })();

  async function startEnrolment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authClient.twoFactor.enable({ password, method: "totp" });
      if (result.error) throw new Error(result.error.message ?? "Enrolment could not be started.");
      const data = result.data;
      if (!data || data.method !== "totp") throw new Error("This account cannot enrol an authenticator app.");
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes);
      setPassword("");
      setMessage("Scan the setup key in your authenticator app, then enter the six-digit code it shows to finish.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enrolment could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: code.replace(/\D/g, "").slice(0, 6) });
      if (result.error) throw new Error(result.error.message ?? "That code was not accepted.");
      setCode("");
      setMessage("Second factor confirmed. Store the backup codes somewhere safe; they are shown only once.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) throw new Error(result.error.message ?? "The second factor could not be removed.");
      setPassword("");
      setMessage("Second factor removed. Restricted platform features stay unavailable until you enrol again.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The second factor could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-card app-card--full" style={{ marginBottom: 14 }}>
      <div className="app-card-title">
        <div>
          <h2>Second factor</h2>
          <p>An authenticator app, plus one-time backup codes. {requiredForRole
            ? "Your platform role requires this: restricted features are refused until it is confirmed."
            : "Optional for your account; recommended if you ever hold a platform role."}</p>
        </div>
        <span className={`status-pill status-pill--${enabled ? "active" : requiredForRole ? "on_hold" : "pending"}`}>
          {enabled ? "enabled" : requiredForRole ? "required" : "not enabled"}
        </span>
      </div>

      {enabled ? (
        <form className="form-stack" onSubmit={disable}>
          <p className="form-hint">Removing the second factor weakens this account. Do it only from a device you trust, and re-enrol afterwards.</p>
          <div className="form-field">
            <label htmlFor="two-factor-disable-password">Confirm your password to remove it</label>
            <input className="form-control" id="two-factor-disable-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <button className="button button--danger" type="submit" disabled={busy || password.length < 1}>{busy ? "Removing…" : "Remove second factor"}</button>
        </form>
      ) : totpUri ? (
        <div className="form-stack">
          <div className="inline-notice">
            <strong>Setup key</strong>
            <p>Enter this key in your authenticator app (Google Authenticator, Aegis, 1Password, Microsoft Authenticator). The full setup link is shown for apps that accept it.</p>
            <p><code style={{ wordBreak: "break-all" }}>{secret}</code></p>
            <p><small style={{ wordBreak: "break-all" }}>{totpUri}</small></p>
          </div>
          {backupCodes.length > 0 && <div className="inline-notice">
            <strong>Backup codes — shown once</strong>
            <p>Each code works a single time if you lose the device. Keep them offline; do not paste them into chat or email.</p>
            <p><code>{backupCodes.join(" ")}</code></p>
          </div>}
          <form className="form-stack" onSubmit={confirmEnrolment}>
            <div className="form-field">
              <label htmlFor="two-factor-code">Six-digit code from the app</label>
              <input className="form-control otp-input" id="two-factor-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
            </div>
            <button className="button button--primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "Confirming…" : "Confirm second factor"}</button>
          </form>
        </div>
      ) : (
        <form className="form-stack" onSubmit={startEnrolment}>
          <div className="form-field">
            <label htmlFor="two-factor-password">Confirm your password to begin</label>
            <input className="form-control" id="two-factor-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <button className="button button--primary" type="submit" disabled={busy || password.length < 1}>{busy ? "Starting…" : "Set up an authenticator app"}</button>
        </form>
      )}

      {error && <div className="auth-error" role="alert">{error}</div>}
      {message && <div className="auth-status" role="status">{message}</div>}
    </section>
  );
}
