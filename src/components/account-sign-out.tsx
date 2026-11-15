"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { releaseDeviceOnSignOut } from "@/lib/push-client";

export function AccountSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  return <div className="account-signout-wrap">
    <button
      className="button button--secondary"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        setError("");
        try {
          // While the session can still say whose device this is. Bounded, and never the reason
          // signing out fails.
          await releaseDeviceOnSignOut();
          const result = await authClient.signOut();
          if (result.error) throw new Error("Sign out failed.");
          router.replace("/login");
          router.refresh();
        } catch {
          setError("Sign out could not be confirmed. Try again.");
          setPending(false);
        }
      }}
    >
      <LogOut size={16} aria-hidden="true" /> {pending ? "Signing out…" : "Sign out securely"}
    </button>
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>;
}
