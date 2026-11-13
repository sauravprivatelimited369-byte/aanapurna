// Type declarations for the start.bat control-flow harness used by tests.
export interface RunBatchOptions {
  batchPath?: string;
  node?: boolean;
  npm?: boolean;
  repo?: boolean;
  userInputs?: string[];
  launcherExit?: number;
}
export interface BatchResult {
  exitCode: number;
  launched: boolean;
  passedArguments: boolean;
  openedDownloadPage: boolean;
  askedForDownloadPage: boolean;
  mentionsDownloadUrl: boolean;
  printedPause: boolean;
  output: string;
}
export function runBatch(options?: RunBatchOptions): BatchResult;
