import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "@/lib/http";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(["verification_record", "authorisation_letter", "operating_address", "capacity_evidence", "other"]);

type DetectedFile = { contentType: "application/pdf" | "image/png" | "image/jpeg"; extension: ".pdf" | ".png" | ".jpg" };

function detectType(buffer: Buffer): DetectedFile | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return { contentType: "application/pdf", extension: ".pdf" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { contentType: "image/png", extension: ".png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg", extension: ".jpg" };
  return null;
}

function privateRoot(): string {
  const configured = process.env.PRIVATE_STORAGE_DIR;
  const root = path.resolve(/*turbopackIgnore: true*/ configured || path.join(process.cwd(), "uploads", "private"));
  const publicRoot = path.resolve(process.cwd(), "public");
  if (root === publicRoot || root.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error("PRIVATE_STORAGE_DIR must be outside the public web root.");
  }
  return root;
}

async function canonicalPrivateRoot(root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const publicPath = path.resolve(process.cwd(), "public");
  const canonicalPublic = await realpath(publicPath).catch(() => publicPath);
  if (canonicalRoot === canonicalPublic || canonicalRoot.startsWith(`${canonicalPublic}${path.sep}`)) {
    throw new Error("PRIVATE_STORAGE_DIR must resolve outside the public web root.");
  }
  return canonicalRoot;
}

async function scanWithClamAV(buffer: Buffer): Promise<"clean" | "unscanned"> {
  const mode = process.env.FILE_SCAN_MODE ?? "disabled";
  if (mode === "disabled") {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, "Private document uploads are disabled until malware scanning is configured.", "FILE_SCANNING_REQUIRED");
    return "unscanned";
  }
  if (mode !== "clamav") throw new Error("Unsupported FILE_SCAN_MODE.");
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(503, "Private document scanning is not configured.", "FILE_SCANNER_NOT_CONFIGURED");
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;
    const finish = (error?: Error, result?: "clean") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result ?? "clean");
    };
    socket.setTimeout(15_000, () => finish(new HttpError(503, "The malware scanner timed out. Try again later.", "FILE_SCANNER_TIMEOUT")));
    socket.once("error", () => finish(new HttpError(503, "The malware scanner is unavailable. Try again later.", "FILE_SCANNER_UNAVAILABLE")));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
    socket.once("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "ascii"));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.once("end", () => {
      if (/FOUND/i.test(response)) return finish(new HttpError(422, "This file did not pass the configured malware scan. Choose another file or contact support.", "FILE_SCAN_REJECTED"));
      if (/OK\0?$/.test(response.trim())) return finish(undefined, "clean");
      finish(new HttpError(503, "The malware scanner returned an unexpected response. Try again later.", "FILE_SCANNER_ERROR"));
    });
  });
}

export async function storePrivateDocument(input: {
  bytes: Buffer;
  originalName: string;
  declaredContentType: string;
  documentType: string;
}) {
  if (!ALLOWED_DOCUMENT_TYPES.has(input.documentType)) throw new HttpError(422, "Choose a supported document category.", "DOCUMENT_TYPE_INVALID");
  if (input.bytes.length === 0 || input.bytes.length > MAX_BYTES) throw new HttpError(413, "Files must be between 1 byte and 8 MB.", "FILE_SIZE_INVALID");
  const detected = detectType(input.bytes);
  if (!detected) throw new HttpError(415, "Only PDF, PNG and JPEG files are accepted.", "FILE_TYPE_UNSUPPORTED");

  const scanStatus = await scanWithClamAV(input.bytes);
  const id = randomUUID();
  const root = privateRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await canonicalPrivateRoot(root);
  const storageKey = id;
  const fullPath = path.join(/*turbopackIgnore: true*/ canonicalRoot, `${storageKey}${detected.extension}`);
  try {
    await writeFile(fullPath, input.bytes, { flag: "wx", mode: 0o600 });
  } catch {
    throw new HttpError(503, "The private file could not be stored. Try again later.", "PRIVATE_STORAGE_FAILED");
  }

  const originalName = path.basename(input.originalName).replace(/[\u0000-\u001f\u007f"/\\]/g, "_").slice(0, 128) || `document${detected.extension}`;
  return {
    id,
    storageKey,
    fullPath,
    originalName,
    declaredContentType: input.declaredContentType.slice(0, 120),
    detectedContentType: detected.contentType,
    extension: detected.extension,
    byteSize: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    documentType: input.documentType,
    scanStatus,
  };
}

export async function removeStoredFile(fullPath: string): Promise<void> {
  await rm(fullPath, { force: true }).catch(() => undefined);
}

export async function resolveStoredFile(storageKey: string, extension: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(storageKey) || ![".pdf", ".png", ".jpg"].includes(extension)) {
    throw new HttpError(404, "Document not found.", "DOCUMENT_NOT_FOUND");
  }
  const root = await canonicalPrivateRoot(privateRoot());
  const pathName = path.resolve(root, `${storageKey}${extension}`);
  if (!pathName.startsWith(`${root}${path.sep}`)) throw new HttpError(404, "Document not found.", "DOCUMENT_NOT_FOUND");
  return pathName;
}

export const privateDocumentMaxBytes = MAX_BYTES;
