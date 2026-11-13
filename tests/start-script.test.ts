import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runBatch } from "../scripts/bat-harness.mjs";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "annapurna-start-sh-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Runs the real start.sh on a POSIX host with stub node/npm executables, so
 * every branch executes for real instead of being simulated.
 */
function runShell({ node = true, npm = true, stdin = "", launcherExit = 0, launcherPresent = true } = {}) {
  const dir = mkdtempSync(join(scratch, "case-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, "scripts"));
  cpSync(resolve(root, "start.sh"), join(dir, "start.sh"));
  if (launcherPresent) writeFileSync(join(dir, "scripts/launch-setup.mjs"), "process.exit(0);\n");
  if (node) {
    // Mirrors the real `node scripts/launch-setup.mjs`: it fails when the
    // script is missing, which is exactly what start.sh must not swallow.
    writeFileSync(
      join(bin, "node"),
      `#!/bin/sh\nif [ "$1" = "scripts/launch-setup.mjs" ] && [ ! -f scripts/launch-setup.mjs ]; then echo "Cannot find module" >&2; exit 1; fi\nexit ${launcherExit}\n`,
    );
    chmodSync(join(bin, "node"), 0o755);
  }
  if (npm) {
    writeFileSync(join(bin, "npm"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "npm"), 0o755);
  }
  try {
    const stdout = execFileSync("/bin/sh", [join(dir, "start.sh")], {
      cwd: dir,
      encoding: "utf8",
      input: stdin,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: process.env.HOME ?? "/tmp", NODE_ENV: "development" },
      timeout: 20_000,
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

// These tests replay start.bat's control flow on this machine. They are a safety
// net for the branch logic (which OS-independent code cannot otherwise reach);
// .github/workflows/ci.yml still runs the real file on windows-2025.
describe.skipIf(process.platform === "win32")("start.sh control flow", () => {
  it("starts the launcher in a healthy environment", () => {
    const result = runShell();
    expect(result.status).toBe(0);
    expect(result.output).toContain("Annapurna Link has stopped");
  });

  it("propagates the launcher's exit code unchanged", () => {
    for (const code of [1, 3, 42, 127]) {
      expect(runShell({ launcherExit: code }).status).toBe(code);
    }
  });

  it("stops with a clear message when Node.js is missing", () => {
    const result = runShell({ node: false });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Node.js was not found");
    expect(result.output).toContain("https://nodejs.org/en/download");
  });

  it("opens the download page only when the user answers yes", () => {
    const yes = runShell({ node: false, stdin: "y\n" });
    expect(yes.status).toBe(1);
    expect(yes.output).toContain("The download page was opened");
    for (const answer of ["n\n", "", "maybe\n"]) {
      const result = runShell({ node: false, stdin: answer });
      expect(result.output).not.toContain("The download page was opened");
      expect(result.output).toContain("No changes were made");
    }
  });

  it("reports a missing npm separately", () => {
    const result = runShell({ npm: false });
    expect(result.status).toBe(1);
    expect(result.output).toContain("npm was not found");
    expect(result.output).not.toContain("Node.js was not found");
  });

  it("does not report success when the launcher script is missing", () => {
    // node fails on the missing module; start.sh must propagate that failure.
    const result = runShell({ launcherPresent: false });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("The launcher stopped with exit code");
  });
});

describe("start.bat control flow", () => {
  it("launches the guided launcher when Node.js and npm exist", () => {
    const result = runBatch({});
    expect(result).toMatchObject({ launched: true, passedArguments: true, openedDownloadPage: false, printedPause: false });
    expect(result.exitCode).toBe(0);
  });

  it("propagates the launcher's exit code and pauses for the user", () => {
    for (const code of [1, 2, 127]) {
      const result = runBatch({ launcherExit: code });
      expect(result.launched).toBe(true);
      expect(result.exitCode).toBe(code);
      expect(result.printedPause).toBe(true);
    }
  });

  it("starts nothing when Node.js is missing, and offers the official page", () => {
    const result = runBatch({ node: false, userInputs: ["n"] });
    expect(result).toMatchObject({ launched: false, openedDownloadPage: false, askedForDownloadPage: true });
    expect(result.exitCode).toBe(1);
    expect(result.mentionsDownloadUrl).toBe(true);
    expect(result.output).toContain("Install Node.js 22 LTS");
  });

  it("opens the download page only on an explicit yes", () => {
    for (const yes of ["y", "Y", "yes", "YES", "Yes", "1"]) {
      expect(runBatch({ node: false, userInputs: [yes] }).openedDownloadPage).toBe(true);
    }
    for (const no of ["n", "N", "no", "nah", "", "maybe"]) {
      expect(runBatch({ node: false, userInputs: [no] }).openedDownloadPage).toBe(false);
    }
  });

  it("reports a missing npm separately from a missing Node.js", () => {
    const result = runBatch({ npm: false });
    expect(result.launched).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("npm was not found");
    expect(result.output).not.toContain("Node.js was not found");
    expect(result.askedForDownloadPage).toBe(false);
  });

  it("explains a run outside the repository instead of crashing", () => {
    const result = runBatch({ repo: false });
    expect(result.launched).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("was not found next to start.bat");
  });

  it("never reaches the launcher on the missing-tool paths", () => {
    for (const options of [{ node: false, userInputs: ["y"] }, { npm: false }, { repo: false }]) {
      expect(runBatch(options).launched).toBe(false);
    }
  });
});

/**
 * Guards a real regression found on the Windows CI runner: a fresh checkout
 * with node_modules already installed skipped the consent prompt entirely and
 * created .env, a database and running servers without approval.
 */
describe("launcher never changes an unapproved machine", () => {
  const launcherRoot = resolve(root, "scripts/launch-setup.mjs");

  function freshCopy() {
    const dir = mkdtempSync(join(scratch, "unapproved-"));
    cpSync(launcherRoot, join(dir, "launch-setup.mjs"));
    cpSync(resolve(root, "scripts/launch-support.mjs"), join(dir, "launch-support.mjs"));
    cpSync(resolve(root, "scripts/create-local-env.mjs"), join(dir, "create-local-env.mjs"));
    cpSync(resolve(root, "package-lock.json"), join(dir, "package-lock.json"));
    cpSync(resolve(root, ".env.example"), join(dir, ".env.example"));
    // Simulates the CI runner: `npm ci` ran, so every package exists, but the
    // launcher never recorded its own fingerprint.
    mkdirSync(join(dir, "node_modules"));
    cpSync(resolve(root, "node_modules/.package-lock.json"), join(dir, "node_modules/.package-lock.json"));
    for (const name of ["next", "embedded-postgres", "pg"]) {
      mkdirSync(join(dir, "node_modules", name), { recursive: true });
      cpSync(resolve(root, "node_modules", name, "package.json"), join(dir, "node_modules", name, "package.json"));
    }
    return dir;
  }

  it("refuses without approval even when nothing needs downloading", () => {
    const dir = freshCopy();
    let status = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [join(dir, "launch-setup.mjs")], {
        cwd: dir,
        encoding: "utf8",
        input: "",
        timeout: 60_000,
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "development", ANNAPURNA_LAUNCH_APPROVED: "0" },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? -1;
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }
    expect(status).toBe(1);
    expect(output).toContain("not attached to a keyboard");
    expect(output).toContain("ANNAPURNA_LAUNCH_APPROVED=1");
    // The machine must be untouched: no settings, no database, no fingerprint.
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(existsSync(join(dir, ".local-data"))).toBe(false);
  }, 70_000);
});
