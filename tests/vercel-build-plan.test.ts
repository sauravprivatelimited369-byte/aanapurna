import { describe, expect, it } from "vitest";
import { vercelBuildSteps } from "@/deployment/build-plan";

describe("Vercel build deployment guard", () => {
  it("runs database migrations only for an explicitly identified production deployment", () => {
    expect(vercelBuildSteps("production")).toEqual(["db:migrate", "db:check", "build"]);
  });

  it.each(["preview", "development", "", undefined])("never runs migrations for VERCEL_ENV=%s", (environment) => {
    expect(vercelBuildSteps(environment)).toEqual(["build"]);
  });
});
