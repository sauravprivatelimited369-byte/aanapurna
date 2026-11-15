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

export async function readPublishedContacts(): Promise<{
  entity: PublishedEntity | null;
  dataProtection: PublishedContact | null;
}> {
  try {
    const { rows } = await pool.query<{ entity: PublishedEntity | null; contact: PublishedContact | null }>(
      "select app_legal_entity() as entity, app_public_data_protection_contact() as contact",
    );
    return { entity: rows[0]?.entity ?? null, dataProtection: rows[0]?.contact ?? null };
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
    const { rows } = await pool.query<{ coverage: { coveredNow?: boolean; hoursAhead?: number } | null }>(
      "select app_on_call_coverage() as coverage",
    );
    const coverage = rows[0]?.coverage;
    return { coveredNow: Boolean(coverage?.coveredNow), hoursAhead: Number(coverage?.hoursAhead ?? 0) };
  } catch {
    return { coveredNow: false, hoursAhead: 0 };
  }
}
