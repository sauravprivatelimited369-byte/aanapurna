import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Verify your email" };
type PageProps = { searchParams: Promise<{ result?: string; error?: string }> };

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const verificationResult = query.error ? query.error : query.result === "verified" ? "verified" : undefined;
  return <AuthForm mode="verify" verificationResult={verificationResult} />;
}
