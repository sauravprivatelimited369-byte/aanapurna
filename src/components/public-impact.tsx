"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Building2, HandHeart, RefreshCw, Utensils, Users } from "lucide-react";
import { PublicImpactResponseSchema, type PublicImpactResponse } from "@/integrations/public-impact-contract";

type ImpactState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; response: PublicImpactResponse };

const metrics = [
  { key: "verifiedServings", label: "Verified servings", Icon: Utensils, description: "Only receipts recorded in servings; other units are not converted." },
  { key: "verifiedDeliveries", label: "Verified deliveries", Icon: BadgeCheck, description: "Confirmed by the receiving organisation with a one-time code." },
  { key: "verifiedOrganizations", label: "Verified organisations", Icon: Building2, description: "Partner records with a completed human review." },
  { key: "activeHelpers", label: "Active Helpers", Icon: HandHeart, description: "Helpers with current approved access." },
  { key: "verifiedGenerators", label: "Verified food donors", Icon: Users, description: "Generator organisations with verified status." },
] as const;

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export function PublicImpact() {
  const [state, setState] = useState<ImpactState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    void fetch("/api/public/impact", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Impact summary unavailable.");
        const parsed = PublicImpactResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Impact summary response was invalid.");
        setState({ status: "loaded", response: parsed.data });
      })
      .catch(() => setState({ status: "unavailable" }))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [retryKey]);

  return <section className="section impact-section" id="impact" aria-labelledby="impact-heading">
    <div className="container">
      <div className="section-head impact-section-head">
        <div>
          <span className="eyebrow section-kicker"><span className="eyebrow-line" /> Measured after the handover</span>
          <h2 className="section-title" id="impact-heading">Impact that can be <em>accounted for.</em></h2>
        </div>
        <p className="section-intro">Only verified receipts count. The figures below come from recorded platform data; no sample values or unit conversions are used.</p>
      </div>

      {state.status === "loading" && <div className="impact-grid" role="status" aria-label="Loading verified impact figures" aria-busy="true">
        {metrics.map(({ key }) => <div className="impact-card impact-skeleton" key={key}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>)}
      </div>}

      {state.status === "unavailable" && <div className="impact-message" role="status" aria-live="polite">
        <div><strong>Verified figures are temporarily unavailable.</strong><p>We could not reach the impact service. No counts are being estimated.</p></div>
        <button className="button button--secondary" type="button" onClick={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }}>
          <RefreshCw size={16} aria-hidden="true" /> Retry figures
        </button>
      </div>}

      {state.status === "loaded" && state.response.status === "empty" && <div className="impact-message impact-empty" role="status" aria-live="polite">
        <span className="impact-empty-mark" aria-hidden="true"><BadgeCheck size={22} /></span>
        <div><strong>No verified impact figures yet.</strong><p>Figures appear after a receiving organisation confirms a delivery. Servings are counted only when a receipt records that unit.</p></div>
        <Link className="app-card-link" href="/how-it-works">See how confirmation works <span aria-hidden="true">↗</span></Link>
      </div>}

      {state.status === "loaded" && state.response.status === "available" && <>
        <div className="impact-grid">
          {metrics.map(({ key, label, Icon, description }) => <article className="impact-card" key={key}>
            <span className="impact-icon"><Icon size={19} aria-hidden="true" /></span>
            <span className="impact-value">{numberFormat.format(state.response.metrics[key])}</span>
            <h3>{label}</h3>
            <p>{description}</p>
          </article>)}
        </div>
        <p className="impact-source-note">Counts reflect verified database records. “Servings” does not include kilograms, boxes, litres or other units.</p>
      </>}
    </div>
  </section>;
}
