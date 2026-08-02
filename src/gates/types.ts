/**
 * Verification gates.
 *
 * The charter's Definition of Done, expressed as code. A gate is one command
 * from the detected toolchain plus a verdict. Nothing here knows about npm:
 * commands come from the Milestone 4 fingerprint.
 */
import type { ToolCommand } from "../repo/toolchain.js";

export const GATE_NAMES = ["build", "typecheck", "lint", "test"] as const;

export type GateName = (typeof GATE_NAMES)[number];

/** Gates that constitute validation, as opposed to producing an artifact. */
export const VALIDATION_GATES: readonly GateName[] = [
  "typecheck",
  "lint",
  "test",
];

export type GateStatus = "pass" | "fail" | "skipped";

export interface GateResult {
  readonly name: GateName;
  readonly status: GateStatus;
  /** Null when the toolchain has no command for this gate. */
  readonly command: string | null;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  /** Trailing output, kept short. Full output only under --verbose. */
  readonly output: string;
}

export interface GateRun {
  /** Epoch milliseconds when the run started. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly results: readonly GateResult[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** True when nothing failed. Skipped gates do not fail a run. */
  readonly ok: boolean;
}

export function commandFor(
  toolchain: {
    readonly build: ToolCommand | null;
    readonly typecheck: ToolCommand | null;
    readonly lint: ToolCommand | null;
    readonly test: ToolCommand | null;
  },
  name: GateName,
): ToolCommand | null {
  return toolchain[name];
}

export function summarize(
  results: readonly GateResult[],
  startedAt: number,
  durationMs: number,
): GateRun {
  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    startedAt,
    durationMs,
    results,
    passed,
    failed,
    skipped,
    ok: failed === 0,
  };
}
