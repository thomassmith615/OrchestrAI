/**
 * `orch review` produces an engineering summary for a human.
 *
 * Read only by construction: it packs context, asks the provider, and prints.
 * Nothing is written to the repository.
 */
import { completeWithContext } from "../ai.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export interface ReviewData {
  readonly summary: string;
  readonly provider: string;
  readonly model: string;
  readonly promptRef: string;
  readonly contextTokens: number;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly filesReviewed: number;
}

export const reviewCommand: CommandDefinition<ReviewData> = {
  name: "review",
  summary: "Generate an engineering summary for human review",
  args: [
    {
      name: "focus",
      description: "Terms to prioritize when selecting context",
      required: false,
    },
  ],
  options: [
    { flags: "--max-tokens <count>", description: "Response budget (default 8000)" },
  ],
  requires: { config: true },

  async execute(context: CommandContext): Promise<CommandResult<ReviewData>> {
    const focusArg = context.args[0];
    const focus =
      focusArg === undefined
        ? []
        : focusArg.split(/[,\s]+/).filter((term) => term.length > 0);

    const maxTokensOption = context.options["maxTokens"];
    const maxTokens =
      typeof maxTokensOption === "string"
        ? Number.parseInt(maxTokensOption, 10)
        : undefined;

    const outcome = await completeWithContext(context, {
      promptId: "review",
      focus,
      ...(maxTokens === undefined || Number.isNaN(maxTokens)
        ? {}
        : { maxTokens }),
    });

    const { result, packed } = outcome;

    return {
      data: {
        summary: result.text,
        provider: result.provider,
        model: result.model,
        promptRef: outcome.promptRef,
        contextTokens: packed.tokens,
        usage: result.usage,
        filesReviewed: packed.included.length,
      },
      report: {
        fields: [
          { label: "Provider", value: `${result.provider} (${result.model})` },
          {
            label: "Context",
            value: `${String(packed.included.length)} files, ${String(packed.tokens)} tokens`,
          },
          {
            label: "Usage",
            value: `${String(result.usage.inputTokens)} in, ${String(result.usage.outputTokens)} out`,
          },
        ],
        notes: ["", result.text],
      },
    };
  },
};
