import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";

export function AccountStateShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return <div className="auth-page">
    <aside className="auth-aside">
      <BrandMark />
      <div className="auth-aside-art" aria-hidden="true" />
      <div className="auth-aside-copy">
        <span className="eyebrow"><span className="eyebrow-line" /> Share every meal. Waste nothing.</span>
        <h1>Good work moves through good hands.</h1>
        <p>Account access is checked against real backend records on every request. Approval is never inferred from a browser setting.</p>
      </div>
      <div className="auth-aside-foot"><ShieldCheck size={15} aria-hidden="true" /> Controlled launch · human review required</div>
    </aside>
    <main className="auth-main">
      <div className="auth-card">
        <Link className="auth-back" href="/">← <span>Back to Annapurna Link</span></Link>
        <span className="eyebrow"><span className="eyebrow-line" /> {eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    </main>
  </div>;
}
