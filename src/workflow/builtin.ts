/**
 * The built-in workflow.
 *
 * Maps the charter's nine step development process onto executable stages.
 * Milestone 8 implements the stages that need no model: understanding the
 * objective, analyzing the repository, establishing a baseline, verifying, and
 * recording. Milestone 9 inserts the design and implement stages into the same
 * pipeline.
 */
import { readGitStatus } from "../repo/git.js";
import { scanRepository } from "../repo/scan.js";
import { runGates, VALIDATION_GATES } from "../gates/index.js";
import type { GateRun } from "../gates/index.js";
import type { ScanSummary } from "../repo/scan.js";
import type { Step, StepContext, StepOutcome } from "./steps.js";

/** Charter step 1: understand the objective. */
export const understandStep: Step = {
  name: "understand",
  description: "Read the current milestone objective from the roadmap",

  run(context: StepContext): StepOutcome {
    if (context.milestone === null) {
      return {
        status: "failed",
        detail: "no incomplete milestone found in the roadmap",
      };
    }

    return {
      status: "ok",
      detail: `M${context.milestone.id}: ${context.milestone.title}`,
      produces: { objective: context.milestone.body || context.milestone.title },
    };
  },
};

/** Charter step 2: analyze the existing repository. */
export const analyzeStep: Step = {
  name: "analyze",
  description: "Inventory the repository and detect its toolchain",

  run(context: StepContext): StepOutcome {
    const scan = scanRepository({ root: context.root, fs: context.hosts.fs });

    return {
      status: "ok",
      detail: `${String(scan.files.length)} files, ${context.toolchain.ecosystem}`,
      produces: { scan },
    };
  },

  postcondition(_context: StepContext, outcome: StepOutcome): string | null {
    const scan = outcome.produces?.["scan"] as ScanSummary | undefined;

    return scan !== undefined && scan.files.length > 0
      ? null
      : "the repository appears to be empty";
  },
};

/**
 * Charter step 7, run first: verify previous functionality.
 *
 * A workflow that starts on a red repository cannot tell its own breakage from
 * breakage it inherited, so the baseline is established before anything else.
 */
export const baselineStep: Step = {
  name: "baseline",
  description: "Run the validation gates before making any change",

  precondition(context: StepContext): string | null {
    const { toolchain } = context;

    return toolchain.test === null &&
      toolchain.lint === null &&
      toolchain.typecheck === null
      ? "no validation commands detected"
      : null;
  },

  run(context: StepContext): StepOutcome {
    const run = runGates({
      root: context.root,
      toolchain: context.toolchain,
      proc: context.hosts.proc,
      clock: context.hosts.clock,
      gates: VALIDATION_GATES,
    });

    return {
      status: run.failed === 0 ? "ok" : "failed",
      detail:
        run.failed === 0
          ? `${String(run.passed)} gates passed`
          : `${String(run.failed)} gates already failing before any change`,
      produces: { baseline: run },
    };
  },
};

/** Charter step 3: preserve architectural consistency. */
export const preflightStep: Step = {
  name: "preflight",
  description: "Confirm the working tree is clean enough to change",

  run(context: StepContext): StepOutcome {
    const git = readGitStatus(context.hosts.proc, context.root);

    if (!git.available) {
      return { status: "failed", detail: "git is unavailable" };
    }

    if (git.dirty) {
      return {
        status: "failed",
        detail: "the working tree has uncommitted changes",
      };
    }

    return {
      status: "ok",
      detail: `${git.branch ?? "detached"} is clean`,
      produces: { git },
    };
  },
};

/** Charter steps 6 and 8: tests pass and the repository builds. */
export const verifyStep: Step = {
  name: "verify",
  description: "Run the validation gates after the change",

  precondition(context: StepContext): string | null {
    return context.data.has("proposal")
      ? null
      : "no change was made in this run";
  },

  run(context: StepContext): StepOutcome {
    const run = runGates({
      root: context.root,
      toolchain: context.toolchain,
      proc: context.hosts.proc,
      clock: context.hosts.clock,
      gates: VALIDATION_GATES,
    });

    const baseline = context.data.get("baseline") as GateRun | undefined;
    const regressed =
      baseline !== undefined && baseline.failed === 0 && run.failed > 0;

    return {
      status: run.failed === 0 ? "ok" : "failed",
      detail: regressed
        ? `${String(run.failed)} gates regressed`
        : run.failed === 0
          ? `${String(run.passed)} gates passed`
          : `${String(run.failed)} gates failed`,
      produces: { verification: run },
    };
  },
};

/** Charter step 9: complete the milestone. */
export const summarizeStep: Step = {
  name: "summarize",
  description: "Report what the run did and what remains",

  run(context: StepContext): StepOutcome {
    const parts: string[] = [];

    const scan = context.data.get("scan") as ScanSummary | undefined;
    if (scan !== undefined) {
      parts.push(`${String(scan.files.length)} files reviewed`);
    }

    const verification = context.data.get("verification") as GateRun | undefined;
    if (verification !== undefined) {
      parts.push(
        verification.failed === 0 ? "gates green" : "gates red",
      );
    }

    return {
      status: "ok",
      detail: parts.length === 0 ? "nothing to summarize" : parts.join(", "),
    };
  },
};

/**
 * The stages available without a model. Milestone 9 splices design and
 * implement between `preflight` and `verify`.
 */
export const BUILTIN_WORKFLOW: readonly Step[] = [
  understandStep,
  analyzeStep,
  preflightStep,
  baselineStep,
  verifyStep,
  summarizeStep,
];
