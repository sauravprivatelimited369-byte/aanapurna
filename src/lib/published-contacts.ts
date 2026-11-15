import "server-only";
import { pool } from "@/db";

/**
 * The two facts that belong on public pages: who the entity is, and who answers personal-data
 * questions. Both come from declarations recorded by a named administrator, read through
 * SECURITY DEFINER functions so an anonymous visitor needs no role. Absent a declaration these
 * return null and the page says so, instead of inventing a company or an email address.
 */
export type PublishedContact = {
  contactName?: string;
  contactEmail?: string;
  hours?: string;
  jurisdiction?: string;
  recordedAt?: string;
};

export type PublishedEntity = {
  entityName?: string;
  jurisdiction?: string;
  registeredAddress?: string;
  registrationReference?: string;
  recordedAt?: string;
};


/**
 * Read a public fact, but never let the page wait on the database for it.
 *
 * These pages have to render without a database — in tests, in a fresh deployment, and during an
 * outage. The pool's own connect timeout is 30 seconds, which is short for an outage and far too long
 * for a page load: a reader would see a blank screen rather than the notice, and a browser test that
 * expects `main` to be visible would time out instead of failing on something meaningful.
 *
 * A public header does not depend on these facts, so a slow answer is treated as no answer. Every
 * caller already renders a truthful "not recorded" state when the value is missing.
 */
const PUBLIC_READ_TIMEOUT_MS = 2_000;

function bounded<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), PUBLIC_READ_TIMEOUT_MS);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

export async function readPublishedContacts(): Promise<{
  entity: PublishedEntity | null;
  dataProtection: PublishedContact | null;
}> {
  try {
    return await bounded((async () => {
      const { rows } = await pool.query<{ entity: PublishedEntity | null; contact: PublishedContact | null }>(
        "select app_legal_entity() as entity, app_public_data_protection_contact() as contact",
      );
      return { entity: rows[0]?.entity ?? null, dataProtection: rows[0]?.contact ?? null };
    })(), { entity: null, dataProtection: null });
  } catch {
    // A missing function means the migration has not run. That is a reason to say "not recorded",
    // never a reason to render a page that implies somebody is answerable.
    return { entity: null, dataProtection: null };
  }
}

/**
 * Real coverage, not a promised one. The support page used to publish a response window whenever an
 * operator set SUPPORT_RESPONSE_HOURS, which measured intention. This reads the rota instead, so the
 * window narrows or disappears when nobody is actually on call.
 */
export async function readOnCallCoverage(): Promise<{ coveredNow: boolean; hoursAhead: number }> {
  try {
    return await bounded((async () => {
      const { rows } = await pool.query<{ coverage: { coveredNow?: boolean; hoursAhead?: number } | null }>(
        "select app_on_call_coverage() as coverage",
      );
      const coverage = rows[0]?.coverage;
      return { coveredNow: Boolean(coverage?.coveredNow), hoursAhead: Number(coverage?.hoursAhead ?? 0) };
    })(), { coveredNow: false, hoursAhead: 0 });
  } catch {
    return { coveredNow: false, hoursAhead: 0 };
  }
}

/**
 * The response window a person is promised, as actually recorded.
 *
 * The privacy page used to say "the advertised window is whatever is recorded on the operations
 * register" — which is a promise nobody outside the organisation could check. This reads the
 * recorded number so the page can state it, and returns null when nobody has recorded one so the
 * page can say that instead of quoting a default.
 */
export async function readPublishedResponseWindow(): Promise<{ hours: number | null; staffedBy: string | null }> {
  try {
    return await bounded((async () => {
      const { rows } = await pool.query<{ hours: number | null; staffed_by: string | null }>(
        "select app_privacy_response_window_hours() as hours, app_public_response_window_contact() as staffed_by",
      );
      return { hours: rows[0]?.hours ?? null, staffedBy: rows[0]?.staffed_by ?? null };
    })(), { hours: null, staffedBy: null });
  } catch {
    return { hours: null, staffedBy: null };
  }
}
