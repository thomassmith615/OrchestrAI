/**
 * Workflow execution and its run log.
 *
 * A run stops at the first failed step. Continuing past a failure would mean
 * later steps operate on state the workflow already knows is wrong, which is
 * exactly the behaviour that makes automation untrustworthy.
 */
import { join } from "node:path";
import type { Step, StepContext, StepResult, StepStatus } from "./steps.js";
import type { FileSystemHost } from "../core/hosts.js";

export const RUNS_DIR = "runs";
export const RUN_SCHEMA_VERSION = 1;

export interface WorkflowRun {
  readonly id: string;
  readonly milestoneId: string | null;
  readonly milestoneTitle: string | null;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly dryRun: boolean;
  readonly steps: readonly StepResult[];
  readonly status: StepStatus;
  /** Name of the step that failed, when one did. */
  readonly failedAt: string | null;
}

interface RunDocument {
  readonly schemaVersion: number;
  readonly run: WorkflowRun;
}

export interface ExecuteOptions {
  readonly steps: readonly Step[];
  readonly context: Omit<StepContext, "data" | "dryRun">;
  readonly dryRun: boolean;
  readonly runId: string;
}

export interface WorkflowOutcome {
  readonly run: WorkflowRun;
  /**
   * Values produced by the steps. Kept out of the run log, which stays a
   * compact record of what happened rather than a copy of every output.
   */
  readonly data: ReadonlyMap<string, unknown>;
}

export async function executeWorkflow(
  options: ExecuteOptions,
): Promise<WorkflowOutcome> {
  const { context } = options;
  const startedAt = context.hosts.clock.now();
  const data = new Map<string, unknown>();
  const results: StepResult[] = [];

  let failedAt: string | null = null;

  for (const step of options.steps) {
    const stepContext: StepContext = {
      ...context,
      dryRun: options.dryRun,
      data,
    };

    if (failedAt !== null) {
      results.push({
        name: step.name,
        description: step.description,
        status: "skipped",
        detail: "earlier step failed",
        durationMs: 0,
      });
      continue;
    }

    // Dry run is checked before preconditions: listing the plan should show
    // every stage, not the subset that happens to be viable right now.
    if (options.dryRun) {
      results.push({
        name: step.name,
        description: step.description,
        status: "skipped",
        detail: "dry run",
        durationMs: 0,
      });
      continue;
    }

    const skipReason = step.precondition?.(stepContext) ?? null;
    if (skipReason !== null) {
      results.push({
        name: step.name,
        description: step.description,
        status: "skipped",
        detail: skipReason,
        durationMs: 0,
      });
      continue;
    }

    context.logger.debug(`step ${step.name}: ${step.description}`);
    const began = context.hosts.clock.now();

    let outcome;
    try {
      outcome = await step.run(stepContext);
    } catch (error: unknown) {
      outcome = {
        status: "failed" as const,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const failedPost =
      outcome.status === "ok"
        ? (step.postcondition?.(stepContext, outcome) ?? null)
        : null;

    const status: StepStatus = failedPost === null ? outcome.status : "failed";

    for (const [key, value] of Object.entries(outcome.produces ?? {})) {
      data.set(key, value);
    }

    results.push({
      name: step.name,
      description: step.description,
      status,
      detail: failedPost ?? outcome.detail,
      durationMs: Math.max(0, context.hosts.clock.now() - began),
    });

    if (status === "failed") {
      failedAt = step.name;
    }
  }

  return {
    run: {
      id: options.runId,
      milestoneId: context.milestone?.id ?? null,
      milestoneTitle: context.milestone?.title ?? null,
      startedAt,
      durationMs: Math.max(0, context.hosts.clock.now() - startedAt),
      dryRun: options.dryRun,
      steps: results,
      status: failedAt === null ? "ok" : "failed",
      failedAt,
    },
    data,
  };
}

export function nextRunId(now: number, existing: readonly string[]): string {
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, "").slice(2, 13);

  let candidate = stamp;
  let suffix = 1;
  while (existing.includes(candidate)) {
    candidate = `${stamp}-${String(suffix)}`;
    suffix += 1;
  }

  return candidate;
}

export function runsRoot(stateDir: string): string {
  return join(stateDir, RUNS_DIR);
}

export function recordRun(
  fs: FileSystemHost,
  stateDir: string,
  run: WorkflowRun,
): boolean {
  if (!fs.exists(stateDir)) {
    return false;
  }

  const dir = runsRoot(stateDir);
  fs.mkdir(dir);

  const document: RunDocument = { schemaVersion: RUN_SCHEMA_VERSION, run };
  fs.writeFile(join(dir, `${run.id}.json`), `${JSON.stringify(document, null, 2)}\n`);

  return true;
}

export function listRuns(
  fs: FileSystemHost,
  stateDir: string,
): readonly WorkflowRun[] {
  const dir = runsRoot(stateDir);

  if (!fs.exists(dir)) {
    return [];
  }

  return fs
    .readDir(dir)
    .filter((entry) => !entry.isDirectory && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        const parsed = JSON.parse(
          fs.readFile(join(dir, entry.name)),
        ) as Partial<RunDocument>;

        return parsed.schemaVersion === RUN_SCHEMA_VERSION
          ? (parsed.run ?? null)
          : null;
      } catch {
        return null;
      }
    })
    .filter((run): run is WorkflowRun => run !== null)
    .sort((a, b) => b.startedAt - a.startedAt);
}
