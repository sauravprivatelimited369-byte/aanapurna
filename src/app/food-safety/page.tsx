import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = { title: "Food safety" };

export default function FoodSafetyPage() {
  return (
    <PublicLayout active="/food-safety">
      <section className="page-hero"><div className="container">
        <span className="eyebrow"><span className="eyebrow-line" /> Care is a human responsibility</span>
        <h1>Records help.<br />They do not certify.</h1>
        <p>Annapurna Link records what partners declare and what happens during a handover. It is not a food laboratory, inspector, regulator, insurer or food-safety certification authority.</p>
      </div></section>
      <section className="prose"><div className="content-narrow">
        <div className="draft-banner"><strong>DRAFT — REQUIRES QUALIFIED FOOD-SAFETY AND LEGAL REVIEW.</strong> This page is not an operating policy or legal advice.</div>
        <h2>Before food is listed</h2><p>A responsible human operating team must approve which food categories can be handled in the chosen location, the required declarations, time windows, storage and transport controls, receiving checks, refusal reasons and escalation process. The application is intentionally configured to keep real donation operations paused until those launch gates are recorded.</p>
        <h2>What the platform records</h2><ul>
          <li>Food source, category, ingredients and known allergens as declared by the Generator.</li>
          <li>Preparation, packaging, use-by or best-before time where relevant.</li>
          <li>Storage and handling instructions, collection window and custody observations.</li>
          <li>Receiver acceptance, refusal, hold, incident, recall and resolution records.</li>
        </ul>
        <h2>When something is wrong</h2><p>Do not distribute food that appears unsuitable, has a mismatch or may have been handled incorrectly. Use the configured hold and escalation process, notify the responsible operations and safety staff, and preserve the record. A report does not automatically determine the cause or replace qualified review.</p>
        <h2>What this page does not promise</h2><p>There is no software-generated safety pass, AI image inspection, temperature guarantee or legal compliance certificate. A recorded declaration is not independent verification. The Generator and responsible human operators remain accountable for truthful declarations and applicable requirements.</p>
      </div></section>
    </PublicLayout>
  );
}
