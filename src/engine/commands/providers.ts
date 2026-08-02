/**
 * `orch providers` lists what the platform can talk to and whether each one is
 * usable right now.
 *
 * `--verify` performs a minimal live round trip. It is opt in because it costs
 * money and requires network access.
 */
import { createProvider, listProviders } from "../../providers/index.js";
import { EXIT_CODES, describeError, isOrchestraiError } from "../../core/errors.js";
import { requireConfig } from "../command.js";
import type { ExitCode } from "../../core/errors.js";
import type { CommandContext, CommandDefinition, CommandResult, FieldStatus } from "../command.js";

export interface ProviderStatus {
  readonly id: string;
  readonly displayName: string;
  readonly selected: boolean;
  readonly credentialEnv: string;
  readonly credentialPresent: boolean;
  readonly defaultModel: string;
  readonly streaming: boolean;
  /** Populated only under --verify. */
  readonly reachable?: boolean;
  readonly detail?: string;
}

export interface ProvidersData {
  readonly selected: string;
  readonly model: string | null;
  readonly providers: readonly ProviderStatus[];
}

/** Smallest useful request: enough to prove credentials and routing work. */
async function verify(
  context: CommandContext,
  id: string,
  model: string | null,
): Promise<{ reachable: boolean; detail: string; exitCode?: ExitCode }> {
  try {
    const provider = createProvider(id, {
      env: context.hosts.env,
      http: context.hosts.http,
      model,
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      maxTokens: 16,
    });

    return {
      reachable: true,
      detail: `${result.model}, ${String(result.usage.inputTokens + result.usage.outputTokens)} tokens`,
    };
  } catch (error: unknown) {
    // A failed verification is a real failure for scripts, so the provider's
    // own exit code is propagated rather than swallowed.
    return {
      reachable: false,
      detail: describeError(error),
      exitCode: isOrchestraiError(error) ? error.exitCode : EXIT_CODES.failure,
    };
  }
}

export const providersCommand: CommandDefinition<ProvidersData> = {
  name: "providers",
  summary: "Display available AI providers and whether they are usable",
  options: [
    {
      flags: "--verify",
      description: "Make a minimal live request to the selected provider",
    },
  ],
  requires: { repository: true, config: true },

  async execute(context: CommandContext): Promise<CommandResult<ProvidersData>> {
    const config = requireConfig(context);
    const selected = config.values.provider;
    const model = config.values.model;
    const shouldVerify = context.options["verify"] === true;

    const providers: ProviderStatus[] = [];
    let exitCode: ExitCode = EXIT_CODES.success;

    for (const descriptor of listProviders()) {
      const credential = context.hosts.env[descriptor.credentialEnv];
      const isSelected = descriptor.id === selected;

      const base: ProviderStatus = {
        id: descriptor.id,
        displayName: descriptor.displayName,
        selected: isSelected,
        credentialEnv: descriptor.credentialEnv,
        credentialPresent: credential !== undefined && credential !== "",
        defaultModel: descriptor.defaultModel,
        streaming: descriptor.capabilities.streaming,
      };

      if (shouldVerify && isSelected) {
        const outcome = await verify(context, descriptor.id, model);
        exitCode = outcome.exitCode ?? exitCode;
        providers.push({
          ...base,
          reachable: outcome.reachable,
          detail: outcome.detail,
        });
      } else {
        providers.push(base);
      }
    }

    const fields = providers.map((entry) => {
      const status: FieldStatus =
        entry.reachable === true
          ? "pass"
          : entry.reachable === false
            ? "fail"
            : entry.credentialPresent
              ? "pass"
              : "warn";

      const detail =
        entry.detail ??
        (entry.credentialPresent
          ? `${entry.credentialEnv} set`
          : `${entry.credentialEnv} not set`);

      return {
        label: entry.selected ? `${entry.id} *` : entry.id,
        value: detail,
        status,
      };
    });

    // Notes carry state, not instructions. The selection is state; telling
    // the operator that --verify exists is what --help is for.
    const notes = [`Selected: ${selected}${model === null ? "" : ` (${model})`}`];

    return {
      data: { selected, model, providers },
      report: { fields, notes },
      exitCode,
    };
  },
};
