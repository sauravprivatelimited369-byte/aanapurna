import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Verification and password-reset mail is sent straight after the response (see
// `@/worker/inline-delivery`), and that work counts towards this limit. Stated here rather than left
// to the host's default, which is ten seconds on some plans and settings: a sender stopped
// mid-conversation leaves its messages reserved for ten minutes, a long time against a link that
// lasts an hour. Sixty seconds is the request, one pass of at most twenty, and a second one if
// another request asked while the first was running - and it is within every plan's ceiling.
export const maxDuration = 60;

export const { GET, POST } = toNextJsHandler(auth);
