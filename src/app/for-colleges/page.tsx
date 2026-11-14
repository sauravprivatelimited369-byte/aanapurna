import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For Colleges & Institutions | Annapurna Link",
  description:
    "Traceable surplus-food redistribution for college campuses, hostels, and institutional kitchens.",
};

export default function ForCollegesPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-slate-900">
      <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Controlled Pilot Preparation:</strong> Annapurna Link is preparing for controlled
        institutional pilots. Real food operations remain gated until partner verification,
        food-safety policy sign-off, and transactional email delivery are completed.
      </div>

      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Surplus Food Redistribution for Colleges &amp; Institutional Kitchens
      </h1>
      <p className="mt-4 text-lg text-slate-700">
        Annapurna Link connects campus dining halls, hostels, and event caterers with verified
        local NGOs and shelters through an auditable, role-based handover workflow.
      </p>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/contact"
          className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Request an Institutional Pilot Discussion
        </Link>
        <Link
          href="/preview"
          className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Explore Fictional Walkthrough (/preview)
        </Link>
      </div>

      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">1. List &amp; Match</h2>
          <p className="mt-2 text-sm text-slate-600">
            Campus kitchens declare portion counts, food categories, allergens, and pickup windows.
            Verified Receivers review offers against their capacity.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">2. Traceable Handover</h2>
          <p className="mt-2 text-sm text-slate-600">
            Approved Helpers claim delivery jobs atomically, record custody events, and complete
            handover using a single-use verification code from the Receiver.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">3. Safety &amp; Exceptions</h2>
          <p className="mt-2 text-sm text-slate-600">
            Receivers inspect arriving food and can refuse unsafe handovers. Incidents, quarantines,
            and recalls remain auditable.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">4. Verified Impact Only</h2>
          <p className="mt-2 text-sm text-slate-600">
            Public and institutional metrics count only confirmed, receipt-verified deliveries—never
            unverified pledges or sample data.
          </p>
        </div>
      </section>
    </main>
  );
}
