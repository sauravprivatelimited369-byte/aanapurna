import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function parseKey(value: string, label: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${label} must be a base64-encoded 32-byte key.`);
  return key;
}

function keyFor(name: "OTP_HASH_KEY" | "OTP_ENCRYPTION_KEY" | "EMAIL_ENCRYPTION_KEY"): Buffer {
  const supplied = process.env[name];
  if (supplied) return parseKey(supplied, name);
  if (process.env.NODE_ENV === "production") throw new Error(`${name} must be configured in production.`);
  const localSecret = process.env.AUTH_SECRET;
  if (!localSecret) throw new Error(`Set ${name} (or AUTH_SECRET for local development).`);
  return Buffer.from(hkdfSync("sha256", Buffer.from(localSecret), Buffer.from("annapurna-local-dev"), Buffer.from(name), 32));
}

export function createDeliveryCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashDeliveryCode(deliveryJobId: string, code: string): Buffer {
  return createHmac("sha256", keyFor("OTP_HASH_KEY")).update(`${deliveryJobId}:${code}`).digest();
}

export function verifyDeliveryCode(deliveryJobId: string, code: string, storedHash: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const supplied = hashDeliveryCode(deliveryJobId, code);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function encryptValue(value: string, keyName: "OTP_ENCRYPTION_KEY" | "EMAIL_ENCRYPTION_KEY"): string {
  const key = keyFor(keyName);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptValue(envelope: string, keyName: "OTP_ENCRYPTION_KEY" | "EMAIL_ENCRYPTION_KEY"): string {
  const [version, ivPart, tagPart, ciphertextPart, extra] = envelope.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart || extra) throw new Error("Invalid encrypted payload.");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(keyName), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}

export function newAuthSecret(): string {
  return randomBytes(48).toString("base64url");
}
