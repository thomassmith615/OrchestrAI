/**
 * `orch propose` and its sub-commands.
 *
 * The write path, and the place Charter Principle 2 is enforced. A proposal is
 * created, staged, and reviewed before anything touches the working tree, and
 * applying one is always an explicit second command.
 */
import { completeWithContext } from "../ai.js";
import {
  applyProposal,
  changeSummary,
  diffForProposal,
  diffStat,
  ensureApplicable,
  latestOpen,
  listProposals,
  nextProposalId,
  parseChangeBlocks,
  requireProposal,
  saveProposal,
  setStatus,
} from "../../proposals/index.js";
import { detectToolchain, readGitStatus } from "../../repo/index.js";
import {
  readGateRun,
  recordGateRun,
  runGates,
  VALIDATION_GATES,
} from "../../gates/index.js";
import { EXIT_CODES, UsageError } from "../../core/errors.js";
import { attempt, requireConfig, requireWorkspace } from "../command.js";
import { gateFields } from "./gates.js";
import type { Proposal } from "../../proposals/index.js";
import type { GateRun } from "../../gates/index.js";
import type { ExitCode } from "../../core/errors.js";
import type {
  CommandContext,
  CommandDefinition,
  CommandResult,
  ReportField,
} from "../command.js";
import { join } from "node:path";

export interface ProposeData {
  readonly proposal: Proposal;
  readonly summary: ReturnType<typeof changeSummary>;
}

export interface ApplyData {
  readonly proposal: Proposal;
  readonly written: readonly string[];
  readonly deleted: readonly string[];
  readonly gates: GateRun | null;
}

function resolveId(context: CommandContext, stateDir: string): Proposal {
  const explicit = context.args[0];

  if (explicit !== undefined) {
    return requireProposal(context.hosts.fs, stateDir, explicit);
  }

  const open = latestOpen(context.hosts.fs, stateDir);

  if (open === null) {
    throw new UsageError(
      "No open proposal",
      'Create one with `orch propose "<task>"`',
    );
  }

  return open;
}

function proposalFields(proposal: Proposal): ReportField[] {
  const summary = changeSummary(proposal.changes);

  return [
    { label: "Proposal", value: proposal.id },
    { label: "Task", value: proposal.task },
    { label: "Status", value: proposal.status },
    { label: "Provider", value: `${proposal.provider} (${proposal.model})` },
    {
      label: "Changes",
      value: `${String(summary.files)} files, +${String(summary.added)} -${String(summary.removed)}`,
    },
  ];
}

export const proposeCommand: CommandDefinition<ProposeData> = {
  name: "propose",
  summary: "Ask the provider for a change, staged for review. Writes nothing.",
  args: [{ name: "task", description: "What to implement" }],
  options: [
    { flags: "--focus <terms>", description: "Terms to prioritize in context" },
    {
      flags: "--max-tokens <count>",
      description: "Response budget (default 8000)",
    },
  ],
  requires: { config: true, initialized: true },

  async execute(context: CommandContext): Promise<CommandResult<ProposeData>> {
    const workspace = requireWorkspace(context);
    const config = requireConfig(context);
    const task = context.args[0] ?? "";

    if (task.trim().length === 0) {
      throw new UsageError("A task description is required");
    }

    // Only an explicit `--focus` is passed on. Deriving terms from the task is
    // the resolver's job now, and it distinguishes terms the user chose from
    // terms it inferred: an explicit one is trusted even when it is lower case.
    const focusOption = context.options["focus"];
    const focus =
      typeof focusOption === "string"
        ? focusOption.split(/[,\s]+/).filter((term) => term.length > 0)
        : undefined;

    const maxTokensOption = context.options["maxTokens"];
    const maxTokens =
      typeof maxTokensOption === "string"
        ? Number.parseInt(maxTokensOption, 10)
        : undefined;

    const outcome = await completeWithContext(context, {
      promptId: "propose",
      variables: { task },
      ...(focus === undefined ? {} : { focus }),
      ...(maxTokens === undefined || Number.isNaN(maxTokens)
        ? {}
        : { maxTokens }),
    });

    const parsed = parseChangeBlocks(outcome.result.text, {
      existing: (path) => {
        const absolute = join(workspace.root, path);
        return context.hosts.fs.exists(absolute)
          ? context.hosts.fs.readFile(absolute)
          : null;
      },
    });

    const proposal: Proposal = {
      id: nextProposalId(
        context.hosts.clock.now(),
        listProposals(context.hosts.fs, workspace.stateDir).map(
          (entry) => entry.id,
        ),
      ),
      task,
      status: "open",
      createdAt: context.hosts.clock.now(),
      changes: parsed.changes,
      notes: parsed.notes,
      provider: outcome.result.provider,
      model: outcome.result.model,
      promptRef: outcome.promptRef,
      contextTokens: outcome.packed.tokens,
      usage: outcome.result.usage,
    };

    saveProposal(context.hosts.fs, workspace.stateDir, proposal);

    const notes: string[] = [];
    if (parsed.notes.length > 0) {
      notes.push("", parsed.notes);
    }
    if (proposal.changes.length === 0) {
      notes.push("", "No changes proposed. Nothing was staged.");
    } else {
      notes.push("", ...diffStat(proposal));
    }

    void config;

    // Say what the task was resolved to before saying what came back. When a
    // proposal is wrong the first question is what the model was shown, and
    // "these files, because they reference this symbol" is a real answer.
    const resolved = outcome.workingSet;

    return {
      data: { proposal, summary: changeSummary(proposal.changes) },
      report: {
        fields: [
          ...proposalFields(proposal),
          ...(resolved.symbols.length === 0
            ? []
            : [
                {
                  label: "Resolved",
                  value: `${resolved.symbols.join(", ")} in ${String(
                    resolved.required.length,
                  )} files`,
                },
              ]),
        ],
        notes,
      },
    };
  },
};

export const proposeListCommand: CommandDefinition<{
  proposals: readonly Proposal[];
}> = {
  name: "propose list",
  summary: "List change proposals, newest first",
  requires: { initialized: true },

  execute(
    context: CommandContext,
  ): Promise<CommandResult<{ proposals: readonly Proposal[] }>> {
    const workspace = requireWorkspace(context);
    const proposals = listProposals(context.hosts.fs, workspace.stateDir);

    return Promise.resolve({
      data: { proposals },
      report: {
        fields: proposals.map((proposal) => ({
          label: proposal.id,
          value: `${proposal.status.padEnd(8)} ${String(proposal.changes.length)} files  ${proposal.task}`,
        })),
        ...(proposals.length === 0 ? { notes: ["No proposals."] } : {}),
      },
    });
  },
};

export const proposeShowCommand: CommandDefinition<{
  proposal: Proposal;
  diff: string;
}> = {
  name: "propose show",
  summary: "Show a proposal's full diff",
  args: [
    {
      name: "id",
      description: "Proposal id, defaults to the newest open one",
      required: false,
    },
  ],
  requires: { initialized: true },

  execute(
    context: CommandContext,
  ): Promise<CommandResult<{ proposal: Proposal; diff: string }>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const proposal = resolveId(context, workspace.stateDir);

      const diff = diffForProposal(
        context.hosts.proc,
        context.hosts.fs,
        workspace.root,
        workspace.stateDir,
        proposal,
      );

      return {
        data: { proposal, diff },
        report: {
          fields: proposalFields(proposal),
          notes: [
            ...(proposal.notes.length > 0 ? ["", proposal.notes] : []),
            "",
            diff,
          ],
        },
      };
    });
  },
};

export const proposeApplyCommand: CommandDefinition<ApplyData> = {
  name: "propose apply",
  summary: "Write a proposal to the working tree and run the gates",
  args: [
    {
      name: "id",
      description: "Proposal id, defaults to the newest open one",
      required: false,
    },
  ],
  options: [
    {
      flags: "--force",
      description: "Apply even though the working tree is dirty",
    },
    { flags: "--no-verify", description: "Skip the gates after applying" },
  ],
  requires: { config: true, initialized: true },

  execute(context: CommandContext): Promise<CommandResult<ApplyData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const proposal = resolveId(context, workspace.stateDir);
      const git = readGitStatus(context.hosts.proc, workspace.root);

      ensureApplicable(proposal, git, context.options["force"] === true);

      const outcome = applyProposal(
        context.hosts.fs,
        context.hosts.proc,
        workspace.root,
        proposal,
      );

      const applied = setStatus(
        context.hosts.fs,
        workspace.stateDir,
        proposal,
        "applied",
      );

      let gates: GateRun | null = null;
      let exitCode: ExitCode = EXIT_CODES.success;

      if (context.options["verify"] !== false) {
        gates = runGates({
          root: workspace.root,
          toolchain: detectToolchain(context.hosts.fs, workspace.root),
          proc: context.hosts.proc,
          clock: context.hosts.clock,
          gates: VALIDATION_GATES,
        });

        const previous = readGateRun(context.hosts.fs, workspace.stateDir);
        recordGateRun(context.hosts.fs, workspace.stateDir, gates);
        void previous;

        if (gates.failed > 0) {
          exitCode = EXIT_CODES.validation;
        }
      }

      const notes: string[] = [];
      if (gates !== null && gates.failed > 0) {
        notes.push(
          "",
          `${String(gates.failed)} gates failed. The tree was clean before this, so \`git checkout .\` reverts it.`,
        );
        for (const result of gates.results) {
          if (result.status === "fail" && result.output.length > 0) {
            notes.push(`--- ${result.name} ---`, result.output);
          }
        }
      }

      return {
        data: {
          proposal: applied,
          written: outcome.written,
          deleted: outcome.deleted,
          gates,
        },
        report: {
          fields: [
            ...proposalFields(applied),
            {
              label: "Written",
              value: `${String(outcome.written.length)} files${
                outcome.deleted.length === 0
                  ? ""
                  : `, ${String(outcome.deleted.length)} deleted`
              }`,
            },
            ...(gates === null ? [] : gateFields(gates)),
          ],
          notes,
        },
        exitCode,
      };
    });
  },
};

export const proposeRejectCommand: CommandDefinition<{ proposal: Proposal }> = {
  name: "propose reject",
  summary: "Mark a proposal rejected without applying it",
  args: [
    {
      name: "id",
      description: "Proposal id, defaults to the newest open one",
      required: false,
    },
  ],
  requires: { initialized: true },

  execute(
    context: CommandContext,
  ): Promise<CommandResult<{ proposal: Proposal }>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const proposal = resolveId(context, workspace.stateDir);

      const rejected = setStatus(
        context.hosts.fs,
        workspace.stateDir,
        proposal,
        "rejected",
      );

      return {
        data: { proposal: rejected },
        report: { fields: proposalFields(rejected) },
      };
    });
  },
};
