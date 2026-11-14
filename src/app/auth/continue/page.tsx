import { redirect } from "next/navigation";
import { resolvePostLoginDestination } from "@/lib/authorization";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opening your workspace" };

/** After login the server resolves the trusted role; the browser never chooses it. */
export default async function ContinuePage() {
  const destination = await resolvePostLoginDestination();
  redirect(destination);
}
