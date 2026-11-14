import { describe, it, expect, beforeAll } from "vitest";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { verifyGithubOidcToken, type GithubJwk, type GithubOidcClaims } from "@/worker/github-oidc";

const REPOSITORY = "sauravprivatelimited369-byte/aanapurna";
const REFS = ["refs/heads/main", "refs/heads/arena/5b937561-aanapurna"];
const AUDIENCE = "annapurna-link-worker";
const KID = "test-key-1";

let privateKey: KeyObject;
let keys: GithubJwk[];

function sign(claims: GithubOidcClaims, options: { kid?: string; alg?: string } = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: options.alg ?? "RS256", typ: "JWT", kid: options.kid ?? KID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function claims(overrides: Partial<GithubOidcClaims> = {}): GithubOidcClaims {
  return {
    iss: "https://token.actions.githubusercontent.com",
    aud: AUDIENCE,
    exp: 2_000_000_000,
    nbf: 1_700_000_000,
    repository: REPOSITORY,
    ref: "refs/heads/main",
    workflow_ref: `${REPOSITORY}/.github/workflows/worker-drain.yml@refs/heads/main`,
    event_name: "workflow_dispatch",
    ...overrides,
  };
}

function verify(token: string, now = 1_900_000_000) {
  return verifyGithubOidcToken(token, { repository: REPOSITORY, refs: REFS, audience: AUDIENCE, keys, now });
}

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  keys = [{ kid: KID, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" }];
});

describe("GitHub Actions OIDC verification", () => {
  it("accepts a correctly signed token from the allowed repository and ref", () => {
    const result = verify(sign(claims()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.repository).toBe(REPOSITORY);
  });

  it("accepts the working branch ref as well as main", () => {
    expect(verify(sign(claims({ ref: "refs/heads/arena/5b937561-aanapurna" }))).ok).toBe(true);
  });

  it("rejects a token signed by a key it does not know", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "not-published" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims())).toString("base64url");
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(other.privateKey).toString("base64url");
    expect(verify(`${header}.${payload}.${signature}`)).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("rejects a token whose payload was altered after signing", () => {
    const [header, , signature] = sign(claims()).split(".") as [string, string, string];
    const tampered = Buffer.from(JSON.stringify(claims({ ref: "refs/heads/attacker" }))).toString("base64url");
    expect(verify(`${header}.${tampered}.${signature}`)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects an expired token", () => {
    expect(verify(sign(claims({ exp: 1_800_000_000 })))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token minted for another audience", () => {
    expect(verify(sign(claims({ aud: "some-other-service" })))).toEqual({ ok: false, reason: "wrong-audience" });
  });

  it("rejects a token from another repository", () => {
    expect(verify(sign(claims({ repository: "attacker/fork" })))).toEqual({ ok: false, reason: "wrong-repository" });
  });

  it("rejects a token minted for another branch", () => {
    expect(verify(sign(claims({ ref: "refs/heads/feature" })))).toEqual({ ok: false, reason: "wrong-ref" });
  });

  it("rejects unsigned and non-RS256 tokens", () => {
    expect(verify("not-a-jwt")).toEqual({ ok: false, reason: "malformed" });
    expect(verify(sign(claims(), { alg: "none" }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token that is not yet valid", () => {
    expect(verify(sign(claims({ nbf: 1_999_000_000 })))).toEqual({ ok: false, reason: "not-yet-valid" });
  });
});
