import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getEmailDeliveryStatus } from "@/email/config";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ error?: string; token?: string }> };

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const query = await searchParams;
  return <AuthForm
    mode="reset"
    resetLinkError={query.error ?? ""}
    emailDelivery={getEmailDeliveryStatus()}
  />;
}
