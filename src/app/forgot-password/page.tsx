import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getEmailDeliveryStatus } from "@/email/config";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" emailDelivery={getEmailDeliveryStatus()} />;
}
