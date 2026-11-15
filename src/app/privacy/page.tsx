import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";
import { readPublishedContacts, readPublishedResponseWindow } from "@/lib/published-contacts";
import { currentLocale } from "@/lib/locale-server";
import { noticeFor, responseWindowParagraph } from "@/domain/privacy-notice";
import { LOCALE_NAMES, t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

/**
 * The privacy notice, rendered from `privacy-notice.ts`.
 *
 * The page holds no prose of its own. Copy lives in the data file, so a wording change is a visible
 * diff in one place. What stays here is only what comes from the database: who the contact is, and
 * whether a response window has been recorded.
 */
export default async function PrivacyPage() {
  const locale = await currentLocale();
  // Hindi and Bengali are offered by the switcher; this notice is not translated into them yet. The
  // resolver says so rather than silently returning English, and the banner below prints the fact in
  // the reader's own language — a page that looks translated and is not is worse than one that says.
  const { notice, translated } = noticeFor(locale);
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
        {!translated && <div className="notice-banner" role="status">
          {t(locale, "language.untranslatedBanner", { language: LOCALE_NAMES[locale] })}
        </div>}
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
