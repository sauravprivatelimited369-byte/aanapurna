import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getEmailDeliveryStatus } from "@/email/config";

export const metadata: Metadata = { title: "Verify your email" };
export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ result?: string; error?: string }> };

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const verificationState = query.error ? "error" : query.result === "verified" ? "verified" : "none";
  return <AuthForm
    mode="verify"
    verificationState={verificationState}
    verificationError={query.error ?? ""}
    emailDelivery={getEmailDeliveryStatus()}
  />;
}
