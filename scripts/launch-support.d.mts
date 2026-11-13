// Type declarations for the dependency-free launcher helpers used by tests.
export const REQUIRED_NODE_MAJOR: number;
export const APP_URL: string;
export const APP_HEALTH_URL: string;
export const SMTP_SINK_PORT: number;
export const MANAGED_POSTGRES_PORT: number;
export const INBOX_VIEWER_PORT: number;
export const INBOX_PATH: string;
export const LOCAL_HOSTS: ReadonlySet<string>;

export type Consent = boolean | null;
export type LocalMode = "managed-fresh" | "managed-existing" | "native-existing" | "needs-attention";
export interface LocalState {
  envExists: boolean;
  markerExists: boolean;
  postgresDataExists: boolean;
  mode: LocalMode;
}
export interface DependencyState {
  state: "current" | "missing" | "stale" | "unknown";
  lockHash: string | null;
  modulesPresent: boolean;
}
export interface PlanStep {
  id: "blocked" | "dependencies" | "database" | "migrate" | "native" | "start" | "open";
  title: string;
  detail?: string;
  estimate?: string;
  needsInternet?: boolean;
  blocking?: boolean;
  informational?: boolean;
}
export interface NpmInvocation {
  command: string;
  args: string[];
  verbatim: boolean;
}
export interface InboxViewer {
  url: string;
  close: () => Promise<void>;
}

export interface Approval {
  approved: boolean;
  source: "flag" | "environment" | null;
}

export function parseConsent(input: unknown, options?: { defaultYes?: boolean }): Consent;
export function resolveApproval(argv: string[], env?: Record<string, string | undefined>): Approval;
export function formatBytes(bytes: number): string;
export function isLocalHttpUrl(value: string): boolean;
export function freeDiskBytes(path: string): number | null;
export function localState(root: string): LocalState;
export function dependencyState(root: string): DependencyState;
export function writeDependencyStamp(root: string): boolean;
export function buildPlan(input: { dependency: Pick<DependencyState, "state">; local: Pick<LocalState, "mode"> }): PlanStep[];
export function envFlag(root: string, key: string): string | null;
export function resolveNpmInvocation(execPath: string, platform: NodeJS.Platform, args: string[]): NpmInvocation;
export function runCommand(command: string, args: string[], options?: Record<string, unknown>): Promise<number>;
export function isPortFree(port: number, host?: string): Promise<boolean>;
export function npmRegistryReachable(timeoutMs?: number): Promise<boolean>;
export function probeHealth(options?: { url?: string; timeoutMs?: number }): Promise<{ status?: string; realOperationsEnabled?: boolean } | null>;
export function escapeHtml(value: unknown): string;
export function parseInbox(raw: string | null | undefined): string[];
export function renderInboxHtml(input: { messages: string[]; inboxPath?: string }): string;
export function startInboxViewer(options: {
  inboxPath: string;
  port?: number;
  host?: string;
  refreshSeconds?: number;
}): Promise<InboxViewer>;
export function openUrl(url: string, platform?: NodeJS.Platform, graceMs?: number): Promise<boolean>;
