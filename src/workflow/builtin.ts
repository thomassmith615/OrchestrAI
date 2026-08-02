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
import {
  applyProposal,
  changeSummary,
  ensureApplicable,
  listProposals,
  nextProposalId,
  parseChangeBlocks,
  saveProposal,
  setStatus,
} from "../proposals/index.js";
import { join } from "node:path";
import type { Proposal } from "../proposals/index.js";
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

/** Charter step 4: design before implementation. */
export const planStep: Step = {
  name: "plan",
  description: "Design an approach for the milestone",

  precondition(context: StepContext): string | null {
    if (context.ai === undefined) {
      return "no provider available";
    }
    return context.milestone === null ? "no milestone to plan" : null;
  },

  async run(context: StepContext): Promise<StepOutcome> {
    const ask = context.ai;
    if (ask === undefined) {
      return { status: "failed", detail: "no provider available" };
    }

    const objective =
      (context.data.get("objective") as string | undefined) ??
      context.milestone?.title ??
      "";

    const reply = await ask({
      promptId: "plan",
      variables: { objective },
      focus: keywords(objective),
    });

    return {
      status: "ok",
      detail: `${reply.model}, ${String(reply.usage.outputTokens)} tokens out`,
      produces: { plan: reply.text, planReply: reply },
    };
  },

  postcondition(_context: StepContext, outcome: StepOutcome): string | null {
    const plan = outcome.produces?.["plan"];

    return typeof plan === "string" && plan.trim().length > 0
      ? null
      : "the provider returned an empty plan";
  },
};

/** Charter step 5: implement only the required feature. */
export const implementStep: Step = {
  name: "implement",
  description: "Stage a change proposal for review",

  precondition(context: StepContext): string | null {
    if (context.ai === undefined) {
      return "no provider available";
    }
    return context.data.has("plan") ? null : "no plan was produced";
  },

  async run(context: StepContext): Promise<StepOutcome> {
    const ask = context.ai;
    if (ask === undefined) {
      return { status: "failed", detail: "no provider available" };
    }

    const objective =
      (context.data.get("objective") as string | undefined) ??
      context.milestone?.title ??
      "";
    const plan = (context.data.get("plan") as string | undefined) ?? "";

    const reply = await ask({
      promptId: "propose",
      variables: { task: `${objective}\n\n## Agreed approach\n\n${plan}` },
      focus: keywords(objective),
    });

    const parsed = parseChangeBlocks(reply.text, {
      existing: (path) => {
        const absolute = join(context.root, path);
        return context.hosts.fs.exists(absolute)
          ? context.hosts.fs.readFile(absolute)
          : null;
      },
    });

    if (parsed.changes.length === 0) {
      return {
        status: "failed",
        detail: `no changes proposed: ${parsed.notes.slice(0, 160)}`,
      };
    }

    const proposal: Proposal = {
      id: nextProposalId(
        context.hosts.clock.now(),
        listProposals(context.hosts.fs, context.stateDir).map((entry) => entry.id),
      ),
      task: objective,
      status: "open",
      createdAt: context.hosts.clock.now(),
      changes: parsed.changes,
      notes: parsed.notes,
      provider: reply.provider,
      model: reply.model,
      promptRef: reply.promptRef,
      contextTokens: reply.contextTokens,
      usage: reply.usage,
    };

    saveProposal(context.hosts.fs, context.stateDir, proposal);
    const summary = changeSummary(proposal.changes);

    return {
      status: "ok",
      detail: `${proposal.id}: ${String(summary.files)} files, +${String(summary.added)} -${String(summary.removed)}`,
      produces: { proposal },
    };
  },
};

/**
 * Charter Principle 2 lives here: the change reaches the working tree only
 * when the operator asked for it on this invocation.
 */
export const applyStep: Step = {
  name: "apply",
  description: "Write the staged proposal to the working tree",

  precondition(context: StepContext): string | null {
    if (!context.apply) {
      return "staged for review, not applied";
    }
    return context.data.has("proposal") ? null : "nothing to apply";
  },

  run(context: StepContext): StepOutcome {
    const proposal = context.data.get("proposal") as Proposal;
    const git = readGitStatus(context.hosts.proc, context.root);

    ensureApplicable(proposal, git, false);

    const outcome = applyProposal(
      context.hosts.fs,
      context.hosts.proc,
      context.root,
      proposal,
    );

    setStatus(context.hosts.fs, context.stateDir, proposal, "applied");

    return {
      status: "ok",
      detail: `${String(outcome.written.length)} files written`,
      produces: { applied: outcome },
    };
  },
};

/** Charter steps 6 and 8: tests pass and the repository builds. */
export const verifyStep: Step = {
  name: "verify",
  description: "Run the validation gates after the change",

  precondition(context: StepContext): string | null {
    return context.data.has("applied")
      ? null
      : "nothing was applied in this run";
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

/** Terms from the objective, used to steer context selection. */
function keywords(objective: string): readonly string[] {
  const stop = new Set([
    "with", "that", "this", "from", "into", "over", "than", "then", "when",
    "each", "must", "will", "have", "them", "they", "your", "and", "the",
    "for", "are", "not", "but", "its",
  ]);

  return [
    ...new Set(
      objective
        .toLowerCase()
        .split(/[^a-z0-9_-]+/)
        .filter((term) => term.length > 3 && !stop.has(term)),
    ),
  ].slice(0, 8);
}

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

    const proposal = context.data.get("proposal") as Proposal | undefined;
    if (proposal !== undefined) {
      parts.push(`proposal ${proposal.id}`);
    }

    const verification = context.data.get("verification") as GateRun | undefined;
    if (verification !== undefined) {
      parts.push(verification.failed === 0 ? "gates green" : "gates red");
    }

    return {
      status: "ok",
      detail: parts.length === 0 ? "nothing to summarize" : parts.join(", "),
    };
  },
};

/**
 * `orch next`: determine the milestone and prepare the work. Read only, apart
 * from the run log. It ends at a plan, deliberately, so that the design can be
 * read and argued with before anything is written.
 */
export const PREPARE_WORKFLOW: readonly Step[] = [
  understandStep,
  analyzeStep,
  preflightStep,
  baselineStep,
  planStep,
  summarizeStep,
];

/**
 * `orch milestone`: the full loop. Stops at a staged proposal unless the
 * operator asked for it to be applied on this invocation.
 */
export const MILESTONE_WORKFLOW: readonly Step[] = [
  understandStep,
  analyzeStep,
  preflightStep,
  baselineStep,
  planStep,
  implementStep,
  applyStep,
  verifyStep,
  summarizeStep,
];
