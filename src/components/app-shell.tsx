import Link from "next/link";
import { ListChecks, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { getWorkspaceNavigation, type WorkspaceLink } from "@/lib/workspace-navigation";
import type { Identity } from "@/lib/identity";

export function AppShell({ identity, current, children, notificationCount = 0 }: {
  identity: Identity;
  current: string;
  children: React.ReactNode;
  notificationCount?: number;
}) {
  const gateOpen = process.env.OPERATIONS_ENABLED === "true";
  const { links, mobilePaths } = getWorkspaceNavigation(identity);

  const activeLink = [...links]
    .filter((link) => current === link.href || (link.href !== "/app" && current.startsWith(`${link.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const currentLabel = activeLink?.label ?? "Workspace";
  const initials = identity.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  const mobileLinks = links.filter((link) => mobilePaths.includes(link.href));
  const groupedLinks = links.reduce<Record<string, WorkspaceLink[]>>((groups, link) => {
    (groups[link.section] ??= []).push(link);
    return groups;
  }, {});

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      <aside className="app-sidebar">
        <div className="app-sidebar-head">
          <BrandMark />
          <span className="top-status"><ShieldCheck size={14} aria-hidden="true" /> Controlled launch</span>
        </div>
        <nav className="app-nav" aria-label="Workspace navigation">
          {Object.entries(groupedLinks).map(([section, sectionLinks]) => <div className="app-nav-section" key={section}>
            <p className="app-workspace-tag">{section}</p>
            {sectionLinks.map(({ href, label, Icon }) => {
              const selected = activeLink?.href === href;
              return <Link className={`app-nav-link${selected ? " is-current" : ""}`} href={href} key={href} aria-current={selected ? "page" : undefined}>
                <span className="app-nav-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="app-nav-link-label">{label}</span>
                {href === "/app/notifications" && notificationCount > 0 && <span className="nav-count" aria-label={`${notificationCount} unread notifications`}>{notificationCount > 99 ? "99+" : notificationCount}</span>}
              </Link>;
            })}
          </div>)}
        </nav>
        <div className="app-sidebar-bottom">
          <div className="inline-notice sidebar-launch-note"><strong>{gateOpen ? "Operations gate enabled" : "Operations paused"}</strong><br />{gateOpen ? "Keep following the approved operating procedure." : "Real donations stay disabled until human launch approvals are recorded."}</div>
          <div className="app-account">
            <span className="avatar" aria-hidden="true">{initials || "A"}</span>
            <span className="account-text"><strong>{identity.name}</strong><small>{identity.email}</small></span>
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{currentLabel}</strong></div>
          <div className="app-top-actions">
            <span className="top-status"><span className="top-status-dot" aria-hidden="true" />{gateOpen ? "Operations gate enabled" : "Operations paused"}</span>
            <details className="app-mobile-menu">
              <summary>
                <ListChecks className="app-mobile-menu-open" size={20} aria-hidden="true" />
                <span className="app-mobile-menu-close" aria-hidden="true">×</span>
                <span className="sr-only">Workspace navigation</span>
              </summary>
              <nav className="app-mobile-nav" aria-label="All workspace pages">
                {links.map(({ href, label, Icon }) => <Link className={`app-nav-link${activeLink?.href === href ? " is-current" : ""}`} href={href} key={href} aria-current={activeLink?.href === href ? "page" : undefined}>
                  <span className="app-nav-icon"><Icon size={18} aria-hidden="true" /></span><span className="app-nav-link-label">{label}</span>
                  {href === "/app/notifications" && notificationCount > 0 && <span className="nav-count">{notificationCount}</span>}
                </Link>)}
                <div className="app-mobile-account"><span className="avatar" aria-hidden="true">{initials || "A"}</span><span className="account-text"><strong>{identity.name}</strong><small>{identity.email}</small></span><SignOutButton /></div>
              </nav>
            </details>
          </div>
        </header>
        <main className="app-content" id="workspace-content" tabIndex={-1}>{children}</main>
      </div>
      <nav className="mobile-bottom" aria-label="Primary workspace navigation">
        {mobileLinks.map(({ href, label, Icon }) => <Link className={`mobile-nav-link${activeLink?.href === href ? " is-current" : ""}`} href={href} key={href} aria-current={activeLink?.href === href ? "page" : undefined}>
          <span aria-hidden="true"><Icon size={19} /></span><span>{label}</span>
        </Link>)}
      </nav>
    </div>
  );
}
