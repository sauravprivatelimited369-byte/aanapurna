import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in" };
type PageProps = { searchParams: Promise<{ reason?: string }> };

export default async function LoginPage({ searchParams }: PageProps) {
  const query = await searchParams;
  return <>
    <AuthForm mode="login" sessionExpired={query.reason === "session-expired"} />
    <div className="container auth-guest-note">
      <p><strong>Signing in is optional for reading.</strong> If you only want to understand the product, the <Link href="/preview">sample handover walkthrough</Link> shows every record in the chain without an account.</p>
    </div>
  </>;
}
