import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Request to join" };

type PageProps = { searchParams: Promise<{ role?: string }> };
const requestedRoles = new Set(["generator", "receiver", "helper"] as const);

export default async function SignupPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const initialRole = requestedRoles.has(query.role as "generator" | "receiver" | "helper")
    ? query.role as "generator" | "receiver" | "helper"
    : "generator";
  return <AuthForm mode="signup" initialRole={initialRole} />;
}
