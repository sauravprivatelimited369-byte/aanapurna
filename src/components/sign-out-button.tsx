"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <span className="signout-wrap">
    <button className="app-signout" type="button" aria-label="Sign out" title="Sign out" disabled={pending} onClick={async () => {
      setPending(true);
      setError("");
      try {
        const result = await authClient.signOut();
        if (result.error) throw new Error("Sign out did not complete.");
        router.replace("/login");
        router.refresh();
      } catch {
        setError("Sign out could not be confirmed. Try again.");
      } finally {
        setPending(false);
      }
    }}>{pending ? <span aria-hidden="true">…</span> : <LogOut size={17} aria-hidden="true" />}</button>
    {error && <span className="app-signout-error" role="alert">{error}</span>}
  </span>;
}
