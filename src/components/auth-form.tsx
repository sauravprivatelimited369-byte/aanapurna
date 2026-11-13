"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { authClient } from "@/lib/auth-client";
import { registrationSchema } from "@/domain/validation";

type AuthMode = "login" | "signup" | "forgot" | "reset" | "verify";
type RequestedRole = "generator" | "receiver" | "helper";
type EmailDelivery = { configured: boolean; missingSettings: string[] };
type AuthFailure = { code?: string; message?: string } | null | undefined;

const roleLabels: Record<RequestedRole, string> = {
  generator: "Food Generator",
  receiver: "Receiver Organisation",
  helper: "Delivery Helper",
};

function friendlyAuthError(error: AuthFailure): { message: string; link?: { href: string; label: string } } {
  const code = error?.code ?? "";
  if (code.includes("EMAIL_NOT_VERIFIED")) {
    return {
      message: "This account still needs email verification. Request a fresh link below.",
      link: { href: "/verify-email", label: "Get a verification link" },
    };
  }
  if (code.includes("ACCOUNT_SUSPENDED") || code.includes("ACCOUNT_DISABLED") || code.includes("ACCOUNT_NOT_PROVISIONED")) {
    return {
      message: "This account is suspended, disabled or not provisioned. It cannot open a new session.",
      link: { href: "/account/suspended", label: "View account status" },
    };
  }
  if (code.includes("INVALID_EMAIL_OR_PASSWORD") || code.includes("INVALID_PASSWORD")) {
    return { message: "Email or password is incorrect." };
  }
  if (code.includes("RATE_LIMIT") || code.includes("TOO_MANY")) {
    return { message: "Too many attempts. Wait a little before trying again." };
  }
  if (code.includes("EMAIL_ALREADY_REGISTERED") || code.includes("USER_ALREADY_EXISTS")) {
    return {
      message: "An account already exists for this email. Sign in or reset your password.",
      link: { href: "/login", label: "Go to sign in" },
    };
  }
  if (code.includes("VALIDATION_FAILED") || code.includes("MISSING_FIELD")) {
    return { message: "Check the form fields and try again." };
  }
  if (code.includes("FAILED_TO_CREATE_SESSION")) {
    return { message: "A session could not be created for this account. Contact the operator if this continues." };
  }
  if (code.includes("CROSS_ORIGIN") || code.includes("ORIGIN_REQUIRED")) {
    return { message: "This request could not be verified. Refresh the page and try again." };
  }
  return { message: "We could not complete that request. Check your details and try again." };
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  help?: string;
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
        minLength={12}
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

function PasswordStrength({ password }: { password: string }) {
  const checks = useMemo(() => [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "lower & upper case", ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: "a number", ok: /\d/.test(password) },
    { label: "a symbol", ok: /[^A-Za-z0-9]/.test(password) },
  ], [password]);
  if (!password) return null;
  const score = checks.filter((check) => check.ok).length;
  return <div className="password-strength" aria-live="polite">
    <div className="password-strength-bar" aria-hidden="true"><span data-score={score} /></div>
    <p className="form-hint">Password strength: <strong>{score >= 3 ? "strong enough" : "add more variety"}</strong> · {checks.filter((check) => check.ok).map((check) => check.label).join(", ") || "none yet"}</p>
  </div>;
}

export function AuthForm({
  mode,
  verificationState = "none",
  verificationError = "",
  resetLinkError = "",
  initialRole = "generator",
  sessionExpired = false,
  emailDelivery,
}: {
  mode: AuthMode;
  verificationState?: "verified" | "error" | "none";
  verificationError?: string;
  resetLinkError?: string;
  initialRole?: RequestedRole;
  sessionExpired?: boolean;
  emailDelivery?: EmailDelivery;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestedRole, setRequestedRole] = useState<RequestedRole>(initialRole);
  const [organizationType, setOrganizationType] = useState<"generator" | "receiver" | "">(initialRole === "helper" ? "" : initialRole);
  const [phone, setPhone] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [cityOrDistrict, setCityOrDistrict] = useState("");
  const [stateOrRegion, setStateOrRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [profileNotes, setProfileNotes] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [working, setWorking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorLink, setErrorLink] = useState<{ href: string; label: string } | undefined>();
  const [error, setError] = useState(() => {
    if (mode === "verify" && verificationState === "error") return "This verification link is invalid or expired. Request a new one below.";
    if (mode === "reset" && resetLinkError) return "This password reset link is invalid or expired. Request a new one to continue.";
    return "";
  });
  const [message, setMessage] = useState(() => {
    if (sessionExpired) return "Your session may have expired. Sign in again to continue; unsaved changes are not submitted.";
    if (mode === "verify" && verificationState === "verified") return "Your email has been verified. You can sign in now. Organisation and Helper access still require a separate human review.";
    return "";
  });

  const copy = {
    login: { title: "Welcome back.", description: "Sign in to continue to your Annapurna Link workspace.", action: "Sign in" },
    signup: { title: "Create a real account.", description: "Register, verify your email, then request human review for your Generator, Receiver or Helper role.", action: "Create account" },
    forgot: { title: "Reset your password.", description: "Enter your account email. The confirmation is the same whether or not it is registered.", action: "Send reset link" },
    reset: { title: "Choose a new password.", description: "Use a fresh password of at least 12 characters. Reset links expire and can be used only once.", action: "Update password" },
    verify: { title: "Check your email.", description: "Verify your address or request a fresh single-use link. Links are rate limited.", action: "Request verification link" },
  }[mode];

  const resetInvalid = mode === "reset" && Boolean(resetLinkError);
  const verificationFailed = mode === "verify" && verificationState === "error";

  function onRoleChange(role: RequestedRole) {
    setRequestedRole(role);
    setOrganizationType(role === "helper" ? "" : role);
    if (role === "helper") setOrganizationName("");
  }

  function showError(failure: AuthFailure) {
    const friendly = friendlyAuthError(failure);
    setError(friendly.message);
    setErrorLink(friendly.link);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || submitted) return;
    setError("");
    setErrorLink(undefined);
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
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) {
          showError(result.error);
          return;
        }
        // The server decides the destination from trusted database records.
        router.replace("/auth/continue");
        router.refresh();
      } else if (mode === "signup") {
        const payload = {
          name: name.trim(),
          email: email.trim(),
          password,
          role: requestedRole,
          phone: phone.trim(),
          organizationName: organizationName.trim() || null,
          organizationType: organizationType || null,
          addressLine: addressLine.trim(),
          cityOrDistrict: cityOrDistrict.trim(),
          stateOrRegion: stateOrRegion.trim(),
          postalCode: postalCode.trim(),
          profileNotes: profileNotes.trim(),
          acceptedTerms,
        };
        const parsed = registrationSchema.safeParse(payload);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the form fields and try again.");
          return;
        }
        const response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        const data = await response.json().catch(() => ({})) as {
          error?: { code?: string; message?: string };
          email?: string;
          emailDelivery?: EmailDelivery;
        };
        if (!response.ok) {
          showError(data.error);
          return;
        }
        setSubmitted(true);
        const delivery = data.emailDelivery ?? emailDelivery;
        if (delivery?.configured) {
          setMessage(`Account created for ${data.email ?? email.trim()}. A verification link has been queued for delivery through the configured mail service. Check your inbox; if it does not arrive, request a fresh link here. Your requested role stays pending human review.`);
        } else {
          const missing = delivery?.missingSettings?.join(", ") ?? "SMTP settings";
          setMessage(`Account created for ${data.email ?? email.trim()}, but this deployment has NO email provider configured (missing: ${missing}). No verification email was actually sent. Ask the site owner to enter those values in the secure deployment settings, then request a link here.`);
        }
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
        if (result.error) {
          showError(result.error);
          return;
        }
        setMessage(emailDelivery?.configured === false
          ? "A reset request was recorded, but email delivery is NOT configured on this deployment, so no email was actually sent. Ask the site owner to configure the mail service."
          : "If this email is registered, a reset link has been queued for delivery through the configured mail service. Delivery is not confirmed until the mail service accepts it.");
      } else if (mode === "verify") {
        const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: "/verify-email?result=verified" });
        if (result.error) {
          showError(result.error);
          return;
        }
        setMessage(emailDelivery?.configured === false
          ? "A verification request was recorded, but email delivery is NOT configured on this deployment, so no email was actually sent. Ask the site owner to configure the mail service."
          : "If this address needs verification, a fresh link has been queued for delivery through the configured mail service. Links are rate limited and expire after one hour.");
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
        setSubmitted(true);
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

          {emailDelivery?.configured === false && (mode === "verify" || mode === "forgot") && <div className="auth-error" role="alert">Email delivery is not configured on this deployment (missing: {emailDelivery.missingSettings.join(", ")}). No email will actually be sent until the site owner enters those values in the secure deployment settings.</div>}

          {resetInvalid ? <div className="account-state-actions">
            <Link className="button button--primary" href="/forgot-password">Request a new reset link</Link>
            <Link className="button button--ghost" href="/login">Back to sign in</Link>
          </div> : <form className="form-stack" onSubmit={onSubmit}>
            {mode === "signup" && <>
              <div className="form-field"><label htmlFor="name">Full name</label><input className="form-control" id="name" name="name" autoComplete="name" maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Name you use at work" /></div>
              <div className="form-field"><label htmlFor="requested-role">I am registering as</label><select className="form-control" id="requested-role" name="requestedRole" value={requestedRole} onChange={(event) => onRoleChange(event.target.value as RequestedRole)} aria-describedby="requested-role-help"><option value="generator">Food Generator</option><option value="receiver">Receiver Organisation</option><option value="helper">Delivery Helper</option></select><span className="form-hint" id="requested-role-help">This records a request for {roleLabels[requestedRole]} access. It does not approve your role. Admin registration is not public.</span></div>
            </>}

            {(mode === "login" || mode === "signup" || mode === "forgot" || mode === "verify") && <div className="form-field"><label htmlFor="email">Email address</label><input className="form-control" id="email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.org" /></div>}

            {mode === "signup" && <>
              <div className="form-field"><label htmlFor="phone">Phone number</label><input className="form-control" id="phone" name="phone" type="tel" autoComplete="tel" maxLength={32} required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" aria-describedby="phone-help" /><span className="form-hint" id="phone-help">Used only for account and delivery coordination.</span></div>
              {requestedRole !== "helper" && <>
                <div className="form-field"><label htmlFor="organization-name">Organisation name</label><input className="form-control" id="organization-name" name="organizationName" autoComplete="organization" maxLength={160} required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Registered organisation name" /></div>
                <div className="form-field"><label htmlFor="organization-type">Organisation type</label><select className="form-control" id="organization-type" name="organizationType" value={organizationType} onChange={(event) => setOrganizationType(event.target.value as "generator" | "receiver" | "")} required><option value="generator">Food Generator</option><option value="receiver">Receiver Organisation</option></select></div>
              </>}
              <div className="form-field"><label htmlFor="address-line">Address</label><input className="form-control" id="address-line" name="addressLine" autoComplete="street-address" maxLength={500} required value={addressLine} onChange={(event) => setAddressLine(event.target.value)} placeholder="Street address" /></div>
              <div className="form-grid">
                <div className="form-field"><label htmlFor="city">Location / area</label><input className="form-control" id="city" name="cityOrDistrict" autoComplete="address-level2" maxLength={120} required value={cityOrDistrict} onChange={(event) => setCityOrDistrict(event.target.value)} placeholder="City or district" /></div>
                <div className="form-field"><label htmlFor="state">State / region</label><input className="form-control" id="state" name="stateOrRegion" autoComplete="address-level1" maxLength={120} value={stateOrRegion} onChange={(event) => setStateOrRegion(event.target.value)} placeholder="Optional" /></div>
              </div>
              <div className="form-field"><label htmlFor="postal-code">Postal code</label><input className="form-control" id="postal-code" name="postalCode" autoComplete="postal-code" maxLength={20} value={postalCode} onChange={(event) => setPostalCode(event.target.value)} placeholder="Optional" /></div>
              <div className="form-field"><label htmlFor="profile-notes">Profile information</label><textarea className="form-control" id="profile-notes" name="profileNotes" maxLength={1000} minLength={10} required value={profileNotes} onChange={(event) => setProfileNotes(event.target.value)} placeholder={requestedRole === "helper" ? "Your availability and delivery experience" : "What your organisation does and the food you handle"} aria-describedby="profile-notes-help" /><span className="form-hint" id="profile-notes-help">Required for the reviewer. Do not include passwords or identity documents.</span></div>
            </>}

            {(mode === "login" || mode === "signup") && <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} help={mode === "signup" ? "Use at least 12 characters with a mix of character types." : undefined} />}
            {mode === "signup" && <PasswordStrength password={password} />}
            {mode === "reset" && <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" help="Use a fresh password of at least 12 characters." />}
            {mode === "reset" && <PasswordStrength password={password} />}
            {(mode === "signup" || mode === "reset") && <PasswordField id="confirm-password" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" help="Enter the same password again." />}

            {mode === "signup" && <label className="checkbox-row" htmlFor="accepted-terms">
              <input id="accepted-terms" name="acceptedTerms" type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
              <span>I have read the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy notice</Link> and understand that my role requires separate human approval.</span>
            </label>}

            <button className="button button--primary auth-submit" type="submit" disabled={working || submitted}>{working ? "Please wait…" : submitted ? "Request recorded" : copy.action} <ArrowRight size={17} aria-hidden="true" /></button>
          </form>}

          {error && <div className="auth-error" role="alert" tabIndex={-1}>{error}{errorLink && <> <Link href={errorLink.href}>{errorLink.label}</Link></>}</div>}
          {message && <div className="auth-status" role="status" aria-live="polite">{message}</div>}
          {verificationFailed && verificationError && <p className="form-hint">Link error code: {verificationError}</p>}
          {resetInvalid && resetLinkError && <p className="form-hint">Link error code: {resetLinkError}</p>}

          {mode === "login" && <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><Link href="/verify-email">Need a verification link?</Link></div>}
          {mode === "verify" && verificationState === "verified" && <div className="account-state-actions"><Link className="button button--primary" href="/login">Continue to sign in</Link></div>}
          {mode === "signup" && <p className="password-note">Account verification is separate from Generator, Receiver or Helper approval. No role selection enables food operations or Admin access.</p>}
          {(mode === "login" || mode === "signup") && <div className="auth-switch">{mode === "signup" ? <>Already have an account? <Link href="/login">Sign in</Link></> : <>Need a partner account? <Link href="/signup">Request to join</Link></>}</div>}
        </div>
      </main>
    </div>
  );
}
