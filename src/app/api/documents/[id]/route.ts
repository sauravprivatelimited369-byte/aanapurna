import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { fail, HttpError } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { getPrivateDocumentRecord } from "@/domain/service";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";
import { resolveStoredFile } from "@/storage/private-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const EXTENSIONS: Record<string, string> = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    await enforceRateLimit({ bucket: "private-document-download-user", subject: identity.id, max: 30, windowSeconds: 60 });
    await enforceRateLimit({ bucket: "private-document-download-ip", subject: getRequestAddressKey(request), max: 60, windowSeconds: 60 });
    const document = await getPrivateDocumentRecord(identity, id);
    if (document.scanStatus !== "clean") throw new HttpError(423, "This document is not available until the malware scanner marks it clean.", "DOCUMENT_NOT_CLEARED");
    if (document.expiresAt && document.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "This document has expired. Ask an organisation owner to upload current evidence.", "DOCUMENT_EXPIRED");
    const extension = EXTENSIONS[document.detectedContentType];
    if (!extension) throw new HttpError(415, "The stored document type is not supported.", "DOCUMENT_TYPE_UNSUPPORTED");
    const bytes = await readFile(await resolveStoredFile(document.storageKey, extension));
    if (bytes.length !== document.byteSize) throw new HttpError(503, "The stored document failed an integrity check. Contact support.", "DOCUMENT_INTEGRITY_FAILED");
    const actualHash = createHash("sha256").update(bytes).digest();
    const expectedHash = Buffer.from(document.sha256, "hex");
    if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      throw new HttpError(503, "The stored document failed an integrity check. Contact support.", "DOCUMENT_INTEGRITY_FAILED");
    }
    const safeName = document.originalName.replace(/[\r\n"\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": document.detectedContentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
