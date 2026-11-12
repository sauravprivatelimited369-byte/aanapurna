import { describe, expect, it } from "vitest";
import { assertSameOrigin, HttpError } from "@/lib/http";

const sameOriginUrl = "https://app.example.test/api/onboarding";

function createMutationRequest(headers: Record<string, string> = {}): Request {
  return new Request(sameOriginUrl, { method: "POST", headers });
}

function thrownError(request: Request): unknown {
  try {
    assertSameOrigin(request);
    return null;
  } catch (error) {
    return error;
  }
}

describe("same-origin mutation protection", () => {
  it("accepts an exact Origin match", () => {
    expect(() => assertSameOrigin(createMutationRequest({
      origin: "https://app.example.test",
      host: "app.example.test",
      "sec-fetch-site": "same-origin",
    }))).not.toThrow();
  });

  it("uses an exact same-origin Referer when a same-origin browser fetch omits Origin", () => {
    expect(() => assertSameOrigin(createMutationRequest({
      referer: "https://app.example.test/app/onboarding",
      host: "app.example.test",
      "sec-fetch-site": "same-origin",
    }))).not.toThrow();
  });

  it("rejects a cross-origin Referer fallback", () => {
    const error = thrownError(createMutationRequest({
      referer: "https://attacker.example/app/onboarding",
      host: "app.example.test",
      "sec-fetch-site": "cross-site",
    }));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("CROSS_ORIGIN");
  });

  it("rejects requests with neither Origin nor Referer", () => {
    const error = thrownError(createMutationRequest({ host: "app.example.test" }));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("ORIGIN_REQUIRED");
  });

  it("does not use a Referer fallback without same-origin Fetch Metadata", () => {
    const error = thrownError(createMutationRequest({
      referer: "https://app.example.test/app/onboarding",
      host: "app.example.test",
    }));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("ORIGIN_REQUIRED");
  });

  it("does not allow Referer to override a mismatched Origin", () => {
    const error = thrownError(createMutationRequest({
      origin: "https://attacker.example",
      referer: "https://app.example.test/app/onboarding",
      host: "app.example.test",
      "sec-fetch-site": "same-origin",
    }));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("CROSS_ORIGIN");
  });
});
