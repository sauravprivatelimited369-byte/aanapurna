/**
 * Keep schema changes out of Vercel Preview/Development builds. Preview deployments
 * share no guaranteed isolated database branch in the current hosted setup, so
 * they must not run the production migrator as a side effect of a preview build.
 */
export function vercelBuildSteps(vercelEnvironment: string | undefined): readonly string[] {
  return vercelEnvironment === "production"
    ? ["db:migrate", "db:check", "build"]
    : ["build"];
}
