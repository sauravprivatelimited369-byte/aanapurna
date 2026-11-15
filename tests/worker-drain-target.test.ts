import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/worker-drain.yml"), "utf8");

describe("scheduled worker target", () => {
  it("drains the canonical production app rather than a deployment preview", () => {
    expect(workflow).toContain("BASE: https://annapurna-link.vercel.app");
    expect(workflow).not.toContain("aanapurna-link-preview.vercel.app");
  });
});
