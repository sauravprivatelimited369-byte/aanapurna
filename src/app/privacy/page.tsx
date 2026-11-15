import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";
import { readPublishedContacts, readPublishedResponseWindow } from "@/lib/published-contacts";
import { currentLocale } from "@/lib/locale-server";
import { privacyNotice, responseWindowParagraph } from "@/domain/privacy-notice";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

/**
 * The privacy notice, rendered from a two-language source.
 *
 * The page holds no prose of its own. Copy lives in `privacy-notice.ts` so that the Odia and English
 * versions sit next to each other, and a change to one is visible as a change to the other. What stays
 * here is only what comes from the database: who the contact is, and whether a response window has
 * been recorded.
 */
export default async function PrivacyPage() {
  const locale = await currentLocale();
  const notice = privacyNotice[locale];
  const [{ entity, dataProtection }, responseWindow] = await Promise.all([
    readPublishedContacts(),
    readPublishedResponseWindow(),
  ]);

  return (
    <PublicLayout>
      <section className="page-hero"><div className="container"><span className="eyebrow"><span className="eyebrow-line" /> {notice.eyebrow}</span><h1>{notice.title}</h1><p>{notice.intro}</p></div></section>
      <section className="prose"><div className="content-narrow">
        <div className="draft-banner">
          <strong>{notice.draftBannerStrong}</strong>{" "}
          {dataProtection ? notice.draftBannerWithContact : notice.draftBannerWithoutContact}
        </div>
        {notice.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index}>
                {paragraph.lead && <strong>{paragraph.lead} </strong>}
                {paragraph.body}
              </p>
            ))}
            {/* The recorded window replaces the static paragraph for the section that discusses it,
                in whichever language is being read. It is the only sentence on this page that changes
                with the database, so it is generated rather than stored. */}
            {section.heading === notice.sections[4]?.heading && (
              <p>{responseWindowParagraph(locale, responseWindow)}</p>
            )}
          </section>
        ))}
        <h2>{notice.contactHeading}</h2>
        {dataProtection ? (
          <>
            <p>{dataProtection.contactName}</p>
            <p><a href={`mailto:${dataProtection.contactEmail}`}>{dataProtection.contactEmail}</a>{dataProtection.hours ? ` · ${dataProtection.hours}` : ""}</p>
          </>
        ) : (
          <p>{notice.noContact}</p>
        )}
        {entity?.entityName ? <p>{notice.controller(entity.entityName, entity.jurisdiction ?? null)}</p> : null}
      </div></section>
    </PublicLayout>
  );
}
