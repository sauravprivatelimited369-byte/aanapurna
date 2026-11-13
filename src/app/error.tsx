"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The boundary intentionally avoids forwarding private request/database details to the browser.
    if (error.digest) console.error("Application route failed", { digest: error.digest });
  }, [error]);

  return <main className="error-boundary" role="alert">
    <span className="error-boundary-icon"><AlertTriangle size={23} aria-hidden="true" /></span>
    <p className="eyebrow"><span className="eyebrow-line" /> A page could not be loaded</p>
    <h1>That did not work.</h1>
    <p className="error-boundary-copy">We could not finish loading this page. Your permissions and submitted records have not been changed by this error.</p>
    <button className="button button--primary" type="button" onClick={reset}><RefreshCw size={16} aria-hidden="true" /> Try this page again</button>
    <Link className="error-boundary-link" href="/">Return to Annapurna Link</Link>
  </main>;
}
