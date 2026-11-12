import { fail, assertSameOrigin, json, HttpError } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { assertDocumentUploadAccess, createPrivateDocumentRecord, listPrivateDocumentRecords } from "@/domain/service";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";
import { privateDocumentMaxBytes, removeStoredFile, storePrivateDocument } from "@/storage/private-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const MAX_REQUEST_BYTES = privateDocumentMaxBytes + 64 * 1024;

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    return json(await listPrivateDocumentRecords(identity, id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  let stored: Awaited<ReturnType<typeof storePrivateDocument>> | undefined;
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    await enforceRateLimit({ bucket: "organization-document-user", subject: identity.id, max: 10, windowSeconds: 60 });
    await enforceRateLimit({ bucket: "organization-document-ip", subject: getRequestAddressKey(request), max: 20, windowSeconds: 60 });
    const contentLengthHeader = request.headers.get("content-length");
    if (!contentLengthHeader) throw new HttpError(411, "A content length is required for private document uploads.", "CONTENT_LENGTH_REQUIRED");
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 1) throw new HttpError(400, "The upload size could not be verified.", "CONTENT_LENGTH_INVALID");
    if (contentLength > MAX_REQUEST_BYTES) throw new HttpError(413, "Files must be 8 MB or smaller.", "FILE_SIZE_INVALID");
    await assertDocumentUploadAccess(identity, id);
    const form = await request.formData();
    const file = form.get("file");
    const documentType = form.get("documentType");
    if (!(file instanceof File)) throw new HttpError(422, "Choose a document to upload.", "FILE_REQUIRED");
    if (file.size === 0 || file.size > privateDocumentMaxBytes) throw new HttpError(413, "Files must be between 1 byte and 8 MB.", "FILE_SIZE_INVALID");
    if (typeof documentType !== "string") throw new HttpError(422, "Choose a document category.", "DOCUMENT_TYPE_INVALID");

    const bytes = Buffer.from(await file.arrayBuffer());
    stored = await storePrivateDocument({ bytes, originalName: file.name, declaredContentType: file.type, documentType });
    const saved = await createPrivateDocumentRecord(identity, id, {
      storageKey: stored.storageKey,
      originalName: stored.originalName,
      declaredContentType: stored.declaredContentType,
      detectedContentType: stored.detectedContentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      documentType: stored.documentType,
      scanStatus: stored.scanStatus,
    });
    return json(saved, 201);
  } catch (error) {
    if (stored) await removeStoredFile(stored.fullPath);
    return fail(error);
  }
}
