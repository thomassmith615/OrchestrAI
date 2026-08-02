/**
 * `orch context` shows what would be sent to a provider, without sending it.
 *
 * Not in the original command surface. Added for the same reason as
 * `orch config`: context packing is the highest risk component in the
 * platform, and a packer whose decisions cannot be inspected is a packer
 * nobody can debug. It costs nothing to run and makes no network calls.
 */
import { packContext, recentlyChanged } from "../../context/index.js";
import { detectToolchain, scanRepository } from "../../repo/index.js";
import { promptRef, findPrompt, renderPrompt } from "../../prompts/index.js";
import { requireConfig, requireWorkspace } from "../command.js";
import type { DroppedFile, IncludedFile } from "../../context/index.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";

export interface ContextData {
  readonly budget: number;
  readonly usable: number;
  readonly tokens: number;
  readonly included: readonly IncludedFile[];
  readonly dropped: readonly DroppedFile[];
  readonly focus: readonly string[];
  readonly prompt: string | null;
}

function countBy(dropped: readonly DroppedFile[], reason: string): number {
  return dropped.filter((entry) => entry.reason === reason).length;
}

export const contextCommand: CommandDefinition<ContextData> = {
  name: "context",
  summary: "Show what would be sent to a provider, and what would be dropped",
  args: [
    {
      name: "focus",
      description: "Terms to prioritize, e.g. a feature or module name",
      required: false,
    },
  ],
  options: [
    { flags: "--show <count>", description: "How many included files to list (default 15)" },
    { flags: "--dropped", description: "List files dropped for budget reasons" },
    { flags: "--print", description: "Print the assembled context itself" },
    { flags: "--prompt <id>", description: "Render a named prompt around the context" },
  ],
  requires: { config: true },

  execute(context: CommandContext): Promise<CommandResult<ContextData>> {
    const workspace = requireWorkspace(context);
    const config = requireConfig(context);

    const focusArg = context.args[0];
    const focus =
      focusArg === undefined || focusArg.length === 0
        ? []
        : focusArg.split(/[,\s]+/).filter((term) => term.length > 0);

    const scan = scanRepository({
      root: workspace.root,
      fs: context.hosts.fs,
      ignore: config.values.ignore,
    });
    const toolchain = detectToolchain(context.hosts.fs, workspace.root);

    const packed = packContext({
      root: workspace.root,
      fs: context.hosts.fs,
      scan,
      toolchain,
      budget: config.values.contextBudget,
      focus,
      recent: recentlyChanged(context.hosts.proc, workspace.root),
    });

    const promptId = context.options["prompt"];
    const rendered =
      typeof promptId === "string"
        ? renderPrompt(promptId, { context: packed.text })
        : null;

    const showOption = context.options["show"];
    const show =
      typeof showOption === "string" ? Number.parseInt(showOption, 10) : 15;
    const limit = Number.isNaN(show) ? 15 : show;

    const fields: ReportField[] = [
      { label: "Budget", value: `${String(packed.budget)} tokens` },
      {
        label: "Usable",
        value: `${String(packed.usable)} tokens (25% reserved)`,
      },
      {
        label: "Packed",
        value: `${String(packed.tokens)} tokens across ${String(packed.included.length)} files`,
      },
      {
        label: "Dropped",
        value: `${String(countBy(packed.dropped, "budget"))} over budget, ${String(
          countBy(packed.dropped, "binary"),
        )} binary, ${String(countBy(packed.dropped, "oversized"))} oversized`,
      },
      ...(focus.length > 0
        ? [{ label: "Focus", value: focus.join(", ") }]
        : []),
      ...(rendered === null
        ? []
        : [
            {
              label: "Prompt",
              value: `${promptRef(findPrompt(String(promptId)) ?? { id: String(promptId), version: 0, file: "", description: "" })}, ${String(rendered.length)} chars`,
            },
          ]),
    ];

    const notes: string[] = [];

    for (const entry of packed.included.slice(0, limit)) {
      notes.push(
        `  ${String(entry.tokens).padStart(6)}  ${entry.path}  [${entry.reasons.join("; ")}]`,
      );
    }
    if (packed.included.length > limit) {
      notes.push(`  ... ${String(packed.included.length - limit)} more included`);
    }

    if (context.options["dropped"] === true) {
      notes.push("", "Dropped for budget:");
      for (const entry of packed.dropped.filter(
        (item) => item.reason === "budget",
      )) {
        notes.push(`  ${String(entry.tokens).padStart(6)}  ${entry.path}`);
      }
    }

    if (context.options["print"] === true) {
      notes.push("", rendered ?? packed.text);
    }

    return Promise.resolve({
      data: {
        budget: packed.budget,
        usable: packed.usable,
        tokens: packed.tokens,
        included: packed.included,
        dropped: packed.dropped,
        focus,
        prompt: rendered,
      },
      report: { fields, notes: ["", "Included, highest ranked first:", ...notes] },
    });
  },
};
