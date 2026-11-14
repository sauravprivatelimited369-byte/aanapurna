import Link from "next/link";
import { ArrowUpRight, Menu, ShieldCheck, X } from "lucide-react";
import { BrandMark } from "@/components/brand";

const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/#impact", label: "Our impact" },
  { href: "/food-safety", label: "Food safety" },
  { href: "/about", label: "About us" },
  { href: "/contact", label: "Contact" },
];

function NavigationLinks({ active, mobile = false }: { active?: string; mobile?: boolean }) {
  return <>
    {primaryLinks.map((link) => <Link
      key={link.href}
      className={`${mobile ? "mobile-nav-link" : "nav-link"}${active === link.href ? " is-active" : ""}`}
      href={link.href}
      aria-current={active === link.href ? "page" : undefined}
    >{link.label}</Link>)}
  </>;
}

export function PublicHeader({ active }: { active?: string }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="container header-inner">
          <BrandMark />
          <nav className="desktop-nav" aria-label="Main navigation">
            <NavigationLinks active={active} />
          </nav>
          <div className="header-actions">
            <Link href="/preview" className="nav-login">Preview</Link>
            <Link href="/login" className="nav-login">Log in</Link>
            <Link href="/signup" className="button button--small button--primary header-join">
              <span className="header-join-full">Join Annapurna</span>
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
              <NavigationLinks active={active} mobile />
              <Link className="mobile-nav-link" href="/preview">Preview the workspace</Link>
              <Link className="mobile-nav-link" href="/login">Log in</Link>
              <Link className="mobile-nav-join" href="/signup">Join Annapurna <ArrowUpRight size={17} aria-hidden="true" /></Link>
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
          <div><span className="footer-heading">Explore</span><Link href="/">Home</Link><Link href="/how-it-works">How it works</Link><Link href="/#impact">Our impact</Link><Link href="/near-iim-calcutta">Local discovery</Link><Link href="/preview">Sample handover</Link></div>
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
