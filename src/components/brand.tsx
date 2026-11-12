import Link from "next/link";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="annapurna LINK home" className={`brand${compact ? " brand--compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 44 44" role="presentation">
          <path d="M9.5 23.8c1.9 8.1 6.2 12.2 12.5 12.2s10.6-4.1 12.5-12.2H9.5Z" fill="currentColor" opacity=".95" />
          <path d="M8.7 21.3h26.6c-.8-2.5-3.2-4.4-6.4-4.4-1.6-4.1-5.2-6.4-9.1-5.1-2.3.7-3.8 2.6-4.3 5-3.1-.2-5.6 1.6-6.8 4.5Z" fill="currentColor" />
          <path d="M22 8.2c1.6 3.6 1.4 5.5-.3 7.3M16.1 16.5c2.9-.2 4.8.5 6 2.3m5.8-1.9c-2.3-.1-4 .5-5.3 2.1" fill="none" stroke="#15130d" strokeLinecap="round" strokeWidth="1.5" />
          <path d="M13.6 27.2c2.1 1.5 4.9 2.3 8.4 2.3s6.3-.8 8.4-2.3" fill="none" stroke="#15130d" strokeLinecap="round" strokeWidth="1.4" opacity=".7" />
        </svg>
      </span>
      {!compact && <span className="brand-wordmark"><strong>annapurna</strong>{" "}<span>LINK</span></span>}
    </Link>
  );
}
