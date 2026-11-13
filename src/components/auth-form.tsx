"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { authClient } from "@/lib/auth-client";

type AuthMode = "login" | "signup" | "forgot" | "reset" | "verify";
type RequestedRole = "generator" | "receiver" | "helper";

function friendlyAuthError(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? "";
  if (code.includes("EMAIL_NOT_VERIFIED")) return "This account still needs email verification. Request a fresh link below.";
  if (code.includes("INVALID_EMAIL_OR_PASSWORD") || code.includes("INVALID_PASSWORD")) return "Email or password is incorrect.";
  if (code.includes("RATE_LIMIT")) return "Too many attempts. Wait a little before trying again.";
  if (code.includes("USER_ALREADY_EXISTS")) return "We could not create an account with those details. If you already registered, try signing in.";
  return "We could not complete that request. Check your details and try again.";
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  help,
  minLength = 12,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  help?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const helpId = `${id}-help`;
  return <div className="form-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input-wrap">
      <input
        className="form-control"
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={128}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={help ? helpId : undefined}
        placeholder={help ? "At least 12 characters" : "Enter your password"}
      />
      <button className="password-toggle" type="button" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
    {help && <span className="form-hint" id={helpId}>{help}</span>}
  </div>;
}

const roleLabels: Record<RequestedRole, string> = {
  generator: "Food donor / Generator",
  receiver: "Community organisation / Receiver",
  helper: "Delivery Helper",
};

export function AuthForm({
  mode,
  verificationResult,
  initialRole = "generator",
  sessionExpired = false,
}: {
  mode: AuthMode;
  verificationResult?: string;
  initialRole?: RequestedRole;
  sessionExpired?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestedRole, setRequestedRole] = useState<RequestedRole>(initialRole);
  const [working, setWorking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(() => {
    if (sessionExpired) return "Your session may have expired. Sign in again to continue; unsaved changes are not submitted.";
    if (mode === "verify" && verificationResult === "verified") return "Your email has been verified. You can sign in now. Organisation and Helper access still require a separate human review.";
    return "";
  });

  const copy = {
    login: { title: "Welcome back.", description: "Sign in to continue to your Annapurna Link workspace.", action: "Sign in" },
    signup: { title: "Start with a request.", description: "Create your account, verify your email, then submit the appropriate partner request for human review.", action: "Create account" },
    forgot: { title: "Reset your password.", description: "Enter your account email. The confirmation is the same whether or not it is registered.", action: "Send reset link" },
    reset: { title: "Choose a new password.", description: "Use a fresh password of at least 12 characters. Reset links expire and can be used only once.", action: "Update password" },
    verify: { title: "Check your email.", description: "If this address needs verification, a new single-use link will be queued.", action: "Request verification link" },
  }[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || submitted) return;
    setError("");
    setMessage("");
    if ((mode === "signup" || mode === "reset") && password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }
    if ((mode === "signup" || mode === "reset") && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setWorking(true);
    try {
      if (mode === "login") {
        const result = await authClient.signIn.email({ email: email.trim(), password, callbackURL: "/app" });
        if (result.error) {
          setError(friendlyAuthError(result.error));
          return;
        }
        router.replace("/app");
        router.refresh();
      } else if (mode === "signup") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          requestedRole,
          callbackURL: "/verify-email?result=verified",
        });
        if (result.error) {
          setError(friendlyAuthError(result.error));
          return;
        }
        setSubmitted(true);
        setMessage("Your account request is recorded. A verification link has been queued; delivery is confirmed only when the configured mail service accepts it. Your selected role remains pending human review.");
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
        if (result.error) {
          setError(friendlyAuthError(result.error));
          return;
        }
        setMessage("If this email is registered, a reset link has been queued. Delivery is not confirmed until the configured mail service accepts it.");
      } else if (mode === "verify") {
        const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: "/verify-email?result=verified" });
        if (result.error) {
          setError(friendlyAuthError(result.error));
          return;
        }
        setMessage("If this address needs verification, a fresh link has been queued. Delivery is not confirmed until the configured mail service accepts it.");
      } else {
        const token = new URLSearchParams(window.location.search).get("token");
        if (!token) {
          setError("This reset link is missing or invalid. Request a new one to continue.");
          return;
        }
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) {
          setError("This reset link is invalid or expired. Request a new one to continue.");
          return;
        }
        setMessage("Your password was updated. Sign in with your new password.");
        window.setTimeout(() => router.replace("/login"), 1600);
      }
    } catch {
      setError("We could not reach the service. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <BrandMark />
        <div className="auth-aside-art" aria-hidden="true" />
        <div className="auth-aside-copy">
          <span className="eyebrow"><span className="eyebrow-line" /> Share every meal. Waste nothing.</span>
          <h1>Good work moves through good hands.</h1>
          <p>Thoughtful coordination for food donors, community organisations and approved Helpers—with a clear record at every handover.</p>
        </div>
        <div className="auth-aside-foot"><ShieldCheck size={15} aria-hidden="true" /> Controlled launch · human review required</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <Link className="auth-back" href="/">← <span>Back to Annapurna Link</span></Link>
          <span className="eyebrow"><span className="eyebrow-line" /> {mode === "signup" ? "Join the network" : "Your account"}</span>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
          {mode === "signup" && <div className="auth-steps" aria-label="Account setup steps"><span className="is-current"><b>1</b> Account</span><span><b>2</b> Verify email</span><span><b>3</b> Human review</span></div>}
          <form className="form-stack" onSubmit={onSubmit}>
            {mode === "signup" && <>
              <div className="form-field"><label htmlFor="name">Your name</label><input className="form-control" id="name" name="name" autoComplete="name" maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Name you use at work" /></div>
              <div className="form-field"><label htmlFor="requested-role">I am here as</label><select className="form-control" id="requested-role" name="requestedRole" value={requestedRole} onChange={(event) => setRequestedRole(event.target.value as RequestedRole)} aria-describedby="requested-role-help"><option value="generator">A food donor / Generator</option><option value="receiver">A community organisation / Receiver</option><option value="helper">A delivery Helper</option></select><span className="form-hint" id="requested-role-help">This records a request for {roleLabels[requestedRole]} access. It does not approve your role.</span></div>
            </>}
            {(mode === "login" || mode === "signup" || mode === "forgot" || mode === "verify") && <div className="form-field"><label htmlFor="email">Email address</label><input className="form-control" id="email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.org" /></div>}
            {(mode === "login" || mode === "signup") && <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} help={mode === "signup" ? "Use at least 12 characters. A unique password is recommended." : undefined} />}
            {mode === "reset" && <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" help="Use a fresh password of at least 12 characters." />}
            {(mode === "signup" || mode === "reset") && <PasswordField id="confirm-password" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" help="Enter the same password again." />}
            <button className="button button--primary auth-submit" type="submit" disabled={working || submitted}>{working ? "Please wait…" : submitted ? "Request recorded" : copy.action} <ArrowRight size={17} aria-hidden="true" /></button>
          </form>
          {error && <div className="auth-error" role="alert" tabIndex={-1}>{error}</div>}
          {message && <div className="auth-status" role="status" aria-live="polite">{message}</div>}
          {mode === "login" && <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><Link href="/verify-email">Need a verification link?</Link></div>}
          {mode === "signup" && <p className="password-note">Account verification is separate from Generator, Receiver or Helper approval. No role selection enables food operations.</p>}
          {(mode === "login" || mode === "signup") && <div className="auth-switch">{mode === "signup" ? <>Already have an account? <Link href="/login">Sign in</Link></> : <>Need a partner account? <Link href="/signup">Request to join</Link></>}</div>}
        </div>
      </main>
    </div>
  );
}
