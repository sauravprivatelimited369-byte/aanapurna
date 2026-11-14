import { createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * Verification of a GitHub Actions OIDC token, used to let a scheduled workflow
 * trigger the outbox drain without sharing a static secret with the workflow.
 *
 * The workflow requests an ID token for a fixed audience; GitHub signs it with
 * RS256 and publishes the keys at `GITHUB_JWKS_URL`. Accepting only a token that
 * proves `repository`, `ref` and `aud` is equivalent to accepting that one
 * workflow on that one branch, and it means no credential is copied into Vercel,
 * GitHub secrets or this repository.
 */

export const GITHUB_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

export type GithubJwk = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };

export type GithubOidcClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  ref?: string;
  workflow_ref?: string;
  event_name?: string;
  sub?: string;
};

export type GithubOidcExpectations = {
  /** `owner/name`, as it appears in the `repository` claim. */
  repository: string;
  /** Allowed git refs, for example `["refs/heads/main"]`. */
  refs: string[];
  /** The audience requested by the workflow. */
  audience: string;
  /** Injected for tests. */
  now?: number;
  /** Injected for tests; production fetches `GITHUB_JWKS_URL`. */
  keys: GithubJwk[];
  /** Tolerated clock skew, in seconds. */
  skewSeconds?: number;
};

export type GithubOidcResult =
  | { ok: true; claims: GithubOidcClaims }
  | { ok: false; reason: "malformed" | "unknown-key" | "bad-signature" | "expired" | "not-yet-valid" | "wrong-audience" | "wrong-repository" | "wrong-ref" };

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function audienceMatches(claim: string | string[] | undefined, expected: string): boolean {
  if (typeof claim === "string") return claim === expected;
  if (Array.isArray(claim)) return claim.includes(expected);
  return false;
}

/**
 * Pure verification step: no network access, so it can be unit tested with a
 * locally generated key pair.
 */
export function verifyGithubOidcToken(token: string, expectations: GithubOidcExpectations): GithubOidcResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeSegment(encodedHeader);
  const payload = decodeSegment(encodedPayload);
  if (!header || !payload) return { ok: false, reason: "malformed" };
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "malformed" };

  const key = expectations.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) return { ok: false, reason: "unknown-key" };

  let publicKey;
  try {
    publicKey = createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: "jwk" });
  } catch {
    return { ok: false, reason: "unknown-key" };
  }

  const signatureValid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!signatureValid) return { ok: false, reason: "bad-signature" };

  const claims = payload as GithubOidcClaims;
  const now = expectations.now ?? Math.floor(Date.now() / 1000);
  const skew = expectations.skewSeconds ?? 60;
  if (typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
  if (now - skew > claims.exp) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && now + skew < claims.nbf) return { ok: false, reason: "not-yet-valid" };
  if (!audienceMatches(claims.aud, expectations.audience)) return { ok: false, reason: "wrong-audience" };
  if (claims.repository !== expectations.repository) return { ok: false, reason: "wrong-repository" };
  if (typeof claims.ref !== "string" || !expectations.refs.includes(claims.ref)) return { ok: false, reason: "wrong-ref" };

  return { ok: true, claims };
}

let cachedKeys: { fetchedAt: number; keys: GithubJwk[] } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

/** Fetch GitHub's signing keys, caching them for ten minutes. */
export async function fetchGithubJwks(fetcher: typeof fetch = fetch): Promise<GithubJwk[]> {
  if (cachedKeys && Date.now() - cachedKeys.fetchedAt < JWKS_TTL_MS) return cachedKeys.keys;
  const response = await fetcher(GITHUB_JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GitHub JWKS request failed with status ${response.status}`);
  const body: unknown = await response.json();
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) throw new Error("GitHub JWKS response has no keys");
  const usable: GithubJwk[] = keys
    .filter((candidate): candidate is GithubJwk => {
      const key = candidate as Partial<GithubJwk> | null;
      return Boolean(key) && typeof key!.kid === "string" && typeof key!.n === "string" && typeof key!.e === "string" && key!.kty === "RSA";
    })
    .map((key) => ({ kid: key.kid, kty: key.kty, n: key.n, e: key.e, ...(key.alg ? { alg: key.alg } : {}), ...(key.use ? { use: key.use } : {}) }));
  if (usable.length === 0) throw new Error("GitHub JWKS response has no RSA keys");
  cachedKeys = { fetchedAt: Date.now(), keys: usable };
  return usable;
}

/** Exposed for tests so a cached key set cannot leak between cases. */
export function resetGithubJwksCache(): void {
  cachedKeys = null;
}
