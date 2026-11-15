import { spawnSync } from "node:child_process";
import { vercelBuildSteps } from "../src/deployment/build-plan.ts";

const target = process.env.VERCEL_ENV;
const steps = vercelBuildSteps(target);
if (target !== "production") {
  console.info(`VERCEL_ENV=${target || "unset"}; skipping database migrations and checks for a non-production build.`);
}

for (const step of steps) {
  const result = spawnSync("npm", ["run", step], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) {
    console.error(`Could not start npm run ${step}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal || result.status !== 0) {
    console.error(`Vercel build step failed: npm run ${step}`);
    process.exit(typeof result.status === "number" ? result.status : 1);
  }
}
