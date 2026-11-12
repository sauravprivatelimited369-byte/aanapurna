import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in" };
type PageProps = { searchParams: Promise<{ reason?: string }> };

export default async function LoginPage({ searchParams }: PageProps) {
  const query = await searchParams;
  return <AuthForm mode="login" sessionExpired={query.reason === "session-expired"} />;
}
