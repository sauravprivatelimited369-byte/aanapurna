"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OfferActions({ offerId, disabled }: { offerId: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function respond(action: "accept" | "reject") {
    if (action === "reject" && reason.trim().length < 5) {
      setError("Add a brief reason before declining this offer.");
      return;
    }
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/offers/${offerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "accept" ? { action } : { action, reason: reason.trim() }),
      });
      const result = await response.json() as { error?: { message?: string }; deliveryJobId?: string };
      if (!response.ok) throw new Error(result.error?.message ?? "Your response could not be saved.");
      setSuccess(action === "accept" ? "Offer accepted. A Helper can now claim the delivery." : "Offer declined. The reason has been recorded.");
      router.refresh();
      if (action === "accept") router.push("/app/deliveries");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your response could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (disabled) return <div className="inline-notice"><strong>Responses are paused.</strong> The operations gate is closed. No acceptance or assignment will be recorded.</div>;
  return <div className="form-stack">
    <div className="form-field"><label htmlFor="decline-reason">Decline reason <span className="form-hint">(only needed to decline)</span></label><textarea className="form-control" id="decline-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Capacity, timing, handling capability or another reason" /></div>
    {error && <div className="auth-error" role="alert">{error}</div>}{success && <div className="auth-status" role="status">{success}</div>}
    <div className="cta-actions"><button className="button button--primary" type="button" disabled={pending} onClick={() => void respond("accept")}>{pending ? "Saving…" : "Accept offer"}</button><button className="button button--ghost" type="button" disabled={pending} onClick={() => void respond("reject")}>Decline with reason</button></div>
  </div>;
}
