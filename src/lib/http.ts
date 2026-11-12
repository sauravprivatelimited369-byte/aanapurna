import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "REQUEST_FAILED") {
    super(message);
    this.name = "HttpError";
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}

export function fail(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ level: "error", event: "api.request_failed", requestId }));
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Try again, or contact operations with the request reference." }, requestId }, 500);
}

export async function readJson<T>(request: Request, schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Send a valid JSON request body.", "INVALID_JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(422, "Check the form fields and try again.", "VALIDATION_FAILED");
  return parsed.data;
}

export function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new HttpError(403, "Cross-site requests are not allowed.", "CROSS_ORIGIN");
  }

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  // Some same-origin fetch implementations omit Origin on POST. Use the browser's
  // Referer only when Fetch Metadata says same-origin, then still compare the exact
  // origin below. Requests without a verifiable same-origin signal fail closed.
  const origin = originHeader ?? (fetchSite === "same-origin" ? refererHeader : null);
  if (!origin) throw new HttpError(403, "This request could not be verified. Refresh the page and try again.", "ORIGIN_REQUIRED");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestUrl = new URL(request.url);
  const expectedOrigin = host
    ? `${forwardedProto ?? requestUrl.protocol.replace(":", "")}://${host}`
    : requestUrl.origin;

  try {
    if (new URL(origin).origin !== new URL(expectedOrigin).origin) {
      throw new HttpError(403, "Cross-site requests are not allowed.", "CROSS_ORIGIN");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "This request could not be verified.", "INVALID_ORIGIN");
  }
}
