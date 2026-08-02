/**
 * Gate execution.
 *
 * Runs detected commands and records structured verdicts. A gate with no
 * command is skipped, never guessed at, and never counted as a pass.
 */
import { commandFor, summarize } from "./types.js";
import type { GateName, GateResult, GateRun } from "./types.js";
import type { ClockHost, ProcessHost } from "../core/hosts.js";
import type { Toolchain } from "../repo/toolchain.js";

/** Gates should not run forever in CI or on a laptop. */
export const DEFAULT_GATE_TIMEOUT_MS = 10 * 60 * 1000;

/** How much trailing output to keep per gate. */
const OUTPUT_TAIL_CHARS = 2000;

export interface RunGatesOptions {
  readonly root: string;
  readonly toolchain: Toolchain;
  readonly proc: ProcessHost;
  readonly clock: ClockHost;
  readonly gates: readonly GateName[];
  readonly timeoutMs?: number;
  /** Called before each gate runs, so long runs are not silent. */
  readonly onStart?: (name: GateName, command: string) => void;
  readonly onFinish?: (result: GateResult) => void;
}

function tail(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.length <= OUTPUT_TAIL_CHARS
    ? trimmed
    : `...\n${trimmed.slice(-OUTPUT_TAIL_CHARS)}`;
}

export function runGates(options: RunGatesOptions): GateRun {
  const startedAt = options.clock.now();
  const results: GateResult[] = [];

  for (const name of options.gates) {
    const command = commandFor(options.toolchain, name);

    if (command === null) {
      const skipped: GateResult = {
        name,
        status: "skipped",
        command: null,
        exitCode: null,
        durationMs: 0,
        timedOut: false,
        output: "",
      };
      results.push(skipped);
      options.onFinish?.(skipped);
      continue;
    }

    const line = [command.command, ...command.args].join(" ");
    options.onStart?.(name, line);

    const began = options.clock.now();
    const outcome = options.proc.run(command.command, command.args, options.root, {
      timeoutMs: options.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
    });
    const durationMs = Math.max(0, options.clock.now() - began);

    const result: GateResult = {
      name,
      status: outcome.ok ? "pass" : "fail",
      command: line,
      exitCode: outcome.code,
      durationMs,
      timedOut: outcome.timedOut,
      output: outcome.ok ? "" : tail(`${outcome.stdout}\n${outcome.stderr}`),
    };

    results.push(result);
    options.onFinish?.(result);
  }

  return summarize(results, startedAt, Math.max(0, options.clock.now() - startedAt));
}
