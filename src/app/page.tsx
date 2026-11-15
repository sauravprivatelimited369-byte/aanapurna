import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  HandHeart,
  ShieldCheck,
  UtensilsCrossed,
} from "lucide-react";
import { FoodArt } from "@/components/food-art";
import { PublicLayout } from "@/components/public-shell";
import { currentLocale } from "@/lib/locale-server";
import { translator } from "@/lib/i18n";

/**
 * The home page, cut down deliberately.
 *
 * It carried eight stacked sections — hero, trust strip, roles, impact, process, promises, a local
 * directory panel and a closing call to action — which is four screens of scrolling before somebody
 * who wants to donate reaches a button they already saw at the top. The owner's read was that it was
 * too long, and it was: every section below the fold was saying something that a dedicated page says
 * better and in more detail.
 *
 * What is left is the three things a first-time reader needs: what this is, which of the three roles
 * is theirs, and one way to start. The process lives on /how-it-works, the promises on /about and
 * /food-safety, the impact figures on /impact, and the Kolkata directory on its own page — all
 * already linked from the navigation and the footer, so nothing was lost, only relocated.
 *
 * The copy is translated. English is the default; Hindi and Bengali follow the reader's choice.
 */

const roles = [
  {
    key: "generator",
    titleKey: "home.role.generator.title",
    labelKey: "home.role.generator.label",
    textKey: "home.role.generator.text",
    actionKey: "home.role.generator.action",
    Icon: UtensilsCrossed,
  },
  {
    key: "receiver",
    titleKey: "home.role.receiver.title",
    labelKey: "home.role.receiver.label",
    textKey: "home.role.receiver.text",
    actionKey: "home.role.receiver.action",
    Icon: Building2,
  },
  {
    key: "helper",
    titleKey: "home.role.helper.title",
    labelKey: "home.role.helper.label",
    textKey: "home.role.helper.text",
    actionKey: "home.role.helper.action",
    Icon: HandHeart,
  },
] as const;

export default async function HomePage() {
  const locale = await currentLocale();
  const t = translator(locale);
  return (
    <PublicLayout active="/">
      <section className="hero hero--home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-line" /> {t("home.eyebrow")}</span>
            <h1 dangerouslySetInnerHTML={{ __html: t("home.title") }} />
            <p className="hero-lead">{t("home.lead")}</p>
            <div className="hero-actions">
              <Link className="button button--primary" href="/signup?role=generator">
                {t("home.donate")} <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link className="button button--secondary" href="/signup?role=helper">{t("home.becomeHelper")}</Link>
            </div>
            <div className="hero-tertiary-row">
              <Link className="hero-tertiary-link" href="/signup?role=receiver">
                {t("home.registerOrg")} <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="hero-tertiary-link" href="/preview">
                {t("home.sampleWalkthrough")} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <div className="hero-note">
              <span className="hero-note-mark" aria-hidden="true"><ShieldCheck size={15} /></span>
              <span>{t("home.reviewNote")}</span>
            </div>
          </div>
          <FoodArt />
        </div>
      </section>

      <section className="section role-section" aria-labelledby="role-heading">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow section-kicker"><span className="eyebrow-line" /> {t("home.rolesEyebrow")}</span>
              <h2 className="section-title" id="role-heading" dangerouslySetInnerHTML={{ __html: t("home.rolesTitle") }} />
            </div>
            <p className="section-intro">{t("home.rolesIntro")}</p>
          </div>
          <div className="role-grid">
            {roles.map(({ key, titleKey, labelKey, textKey, actionKey, Icon }) => (
              <article className="role-card" key={key}>
                <span className="role-card-icon"><Icon size={22} aria-hidden="true" /></span>
                <span className="role-card-label">{t(labelKey)}</span>
                <h3>{t(titleKey)}</h3>
                <p>{t(textKey)}</p>
                <Link className="role-card-link" href={`/signup?role=${key}`}>
                  {t(actionKey)}<ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section final-cta-section">
        <div className="container">
          <div className="cta-panel final-cta-panel">
            <div>
              <span className="eyebrow"><span className="eyebrow-line" /> {t("home.closingEyebrow")}</span>
              <h2>{t("home.closingTitle")}</h2>
              <p>{t("home.closingText")}</p>
            </div>
            <div className="cta-actions">
              <Link className="button button--primary" href="/signup">
                {t("home.startRequest")} <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link className="button button--secondary" href="/how-it-works">{t("nav.howItWorks")}</Link>
              <Link className="button button--secondary" href="/contact">{t("home.contactSupport")}</Link>
            </div>
            {/* The impact panel used to sit at the foot of this page. It has its own page now, so the
                way to it lives here rather than in the closing buttons: it is something to read, not a
                third call to action competing with the two that matter. */}
            <p className="closing-aside">
              <Link href="/impact">{t("nav.impact")}</Link>
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
