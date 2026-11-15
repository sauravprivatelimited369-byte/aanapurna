import Link from "next/link";
import { ArrowUpRight, Menu, ShieldCheck, X } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { currentLocale } from "@/lib/locale-server";
import { translator, type Locale, type MessageKey } from "@/lib/i18n";

const primaryLinks: { href: string; key: MessageKey }[] = [
  { href: "/", key: "nav.home" },
  { href: "/how-it-works", key: "nav.howItWorks" },
  { href: "/impact", key: "nav.impact" },
  { href: "/food-safety", key: "nav.foodSafety" },
  { href: "/answers", key: "nav.answers" },
  { href: "/about", key: "nav.about" },
  { href: "/contact", key: "nav.contact" },
];

function NavigationLinks({ active, mobile = false, locale }: { active?: string; mobile?: boolean; locale: Locale }) {
  const t = translator(locale);
  return <>
    {primaryLinks.map((link) => <Link
      key={link.href}
      className={`${mobile ? "mobile-nav-link" : "nav-link"}${active === link.href ? " is-active" : ""}`}
      href={link.href}
      lang={locale === "or" ? "or-IN" : `${locale}-IN`}
      aria-current={active === link.href ? "page" : undefined}
    >{t(link.key)}</Link>)}
  </>;
}

export async function PublicHeader({ active }: { active?: string }) {
  const locale = await currentLocale();
  const t = translator(locale);
  return (
    <>
      <a className="skip-link" href="#main-content">{t("common.skipToContent")}</a>
      <header className="site-header">
        <div className="container header-inner">
          <BrandMark />
          <nav className="desktop-nav" aria-label="Main navigation">
            <NavigationLinks active={active} locale={locale} />
          </nav>
          <div className="header-actions">
            <LocaleSwitcher current={locale} />
            <Link href="/preview" className="nav-login">{t("nav.preview")}</Link>
            <Link href="/login" className="nav-login">{t("nav.login")}</Link>
            <Link href="/signup" className="button button--small button--primary header-join">
              <span className="header-join-full">{t("nav.join")}</span>
              <span className="header-join-short">Join</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <details className="mobile-nav-menu">
            <summary className="mobile-menu-toggle">
              <Menu className="mobile-menu-open-icon" size={22} aria-hidden="true" />
              <X className="mobile-menu-close-icon" size={22} aria-hidden="true" />
              <span className="sr-only">Site navigation</span>
            </summary>
            <nav className="mobile-nav-panel" aria-label="Mobile navigation">
              {/* The header switcher collapses below 380px, so the menu carries its own. Without
                  this a phone user would lose the only way to change language. */}
              <LocaleSwitcher current={locale} />
              <NavigationLinks active={active} mobile locale={locale} />
              <Link className="mobile-nav-link" href="/preview">{t("nav.preview")}</Link>
              <Link className="mobile-nav-link" href="/login">{t("nav.login")}</Link>
              <Link className="mobile-nav-join" href="/signup">{t("nav.join")} <ArrowUpRight size={17} aria-hidden="true" /></Link>
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-top">
        <div className="footer-brand-block">
          <BrandMark />
          <p className="footer-note">A thoughtful link between surplus food and the communities ready to receive it.</p>
          <p className="footer-launch-note"><ShieldCheck size={15} aria-hidden="true" /> Controlled launch · human approvals pending</p>
        </div>
        <div className="footer-links">
          <div><span className="footer-heading">Explore</span><Link href="/">Home</Link><Link href="/how-it-works">How it works</Link><Link href="/impact">Our impact</Link><Link href="/near-iim-calcutta">Local discovery</Link><Link href="/joka">Joka directory</Link><Link href="/preview">Sample handover</Link></div>
          <div><span className="footer-heading">The work</span><Link href="/about">About us</Link><Link href="/food-safety">Food safety disclaimer</Link><Link href="/contact">Contact</Link><Link href="/login">Account support</Link></div>
          <div><span className="footer-heading">Policies</span><Link href="/privacy">Privacy <small>Draft</small></Link><Link href="/terms">Terms <small>Draft</small></Link><Link href="/accessibility">Accessibility</Link></div>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} Annapurna Link</span>
        <span>Share Every Meal. Waste Nothing.</span>
        <span className="footer-draft">Not yet approved for live food operations</span>
      </div>
    </footer>
  );
}

export function PublicLayout({ children, active }: { children: React.ReactNode; active?: string }) {
  return <><PublicHeader active={active} /><main id="main-content" tabIndex={-1}>{children}</main><PublicFooter /></>;
}
