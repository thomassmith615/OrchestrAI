/**
 * Workflow steps.
 *
 * The charter's nine step development process, expressed as executable stages
 * rather than instructions in a document. A step declares what must be true
 * before it runs and what must be true after, so a workflow that goes wrong
 * stops at a named boundary instead of continuing on bad state.
 *
 * Nothing here imports the engine or a provider. Steps that need a model
 * receive an injected `ai` function, which keeps this module usable from any
 * surface and testable without a network.
 */
import type { Hosts } from "../core/hosts.js";
import type { Logger } from "../core/logger.js";
import type { Toolchain } from "../repo/toolchain.js";
import type { Milestone } from "./roadmap.js";

export type StepStatus = "ok" | "failed" | "skipped";

export interface StepOutcome {
  readonly status: StepStatus;
  /** One line shown in the run report. */
  readonly detail: string;
  /** Values later steps can read, keyed by name. */
  readonly produces?: Readonly<Record<string, unknown>>;
}

export interface StepContext {
  readonly root: string;
  readonly stateDir: string;
  readonly hosts: Hosts;
  readonly logger: Logger;
  readonly toolchain: Toolchain;
  readonly milestone: Milestone | null;
  /** True when the workflow is being listed rather than executed. */
  readonly dryRun: boolean;
  /** Outputs of earlier steps in this run. */
  readonly data: ReadonlyMap<string, unknown>;
}

export interface Step {
  readonly name: string;
  readonly description: string;
  /**
   * Returns a reason to skip, or null to proceed. A skipped step is not a
   * failure: a repository with no lint command should not fail a workflow.
   */
  precondition?(context: StepContext): string | null;
  run(context: StepContext): StepOutcome | Promise<StepOutcome>;
  /** Returns a reason the step's result is unusable, or null. */
  postcondition?(context: StepContext, outcome: StepOutcome): string | null;
}

export interface StepResult {
  readonly name: string;
  readonly description: string;
  readonly status: StepStatus;
  readonly detail: string;
  readonly durationMs: number;
}

/** Reads a typed value produced by an earlier step. */
export function produced<T>(
  context: StepContext,
  key: string,
): T | undefined {
  return context.data.get(key) as T | undefined;
}
