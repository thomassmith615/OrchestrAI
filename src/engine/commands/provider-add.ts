/**
 * `orch provider add <name>` selects and configures a provider.
 *
 * It writes only the keys it changes, and never writes a credential. Secrets
 * stay in the environment.
 */
import { patchConfigFile } from "../../core/config/index.js";
import { findProvider, providerIds } from "../../providers/index.js";
import { EXIT_CODES, OrchestraiError } from "../../core/errors.js";
import { requireWorkspace } from "../command.js";
import type { ConfigPatch } from "../../core/config/index.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export interface ProviderAddData {
  readonly provider: string;
  readonly model: string | null;
  readonly changed: readonly string[];
  readonly credentialEnv: string;
  readonly credentialPresent: boolean;
  readonly configPath: string;
}

export const providerAddCommand: CommandDefinition<ProviderAddData> = {
  name: "provider add",
  summary: "Select and configure an AI provider",
  args: [{ name: "name", description: "Provider id, e.g. anthropic" }],
  options: [
    { flags: "--model <id>", description: "Pin a model for this provider" },
  ],
  requires: { repository: true, config: true },

  execute(context: CommandContext): Promise<CommandResult<ProviderAddData>> {
    const workspace = requireWorkspace(context);
    const name = context.args[0] ?? "";
    const descriptor = findProvider(name);

    if (descriptor === undefined) {
      // Rejecting rather than throwing keeps the promise contract intact for
      // callers that never enter an async frame.
      return Promise.reject(
        new OrchestraiError(`Unknown provider: ${name}`, {
          code: "provider.unknown",
          exitCode: EXIT_CODES.configuration,
          hint: `Known providers: ${providerIds().join(", ")}`,
        }),
      );
    }

    const modelOption = context.options["model"];
    const model = typeof modelOption === "string" ? modelOption : null;

    const patch: ConfigPatch = {
      provider: descriptor.id,
      ...(model === null ? {} : { model }),
    };

    const changed = patchConfigFile(workspace.configPath, context.hosts.fs, patch);

    const credential = context.hosts.env[descriptor.credentialEnv];
    const credentialPresent = credential !== undefined && credential !== "";

    const notes = credentialPresent
      ? ["Run `orch providers --verify` to make a live request."]
      : [
          `Set ${descriptor.credentialEnv} in your environment before use.`,
          "Credentials are never written to the config file.",
        ];

    return Promise.resolve({
      data: {
        provider: descriptor.id,
        model,
        changed,
        credentialEnv: descriptor.credentialEnv,
        credentialPresent,
        configPath: workspace.configPath,
      },
      report: {
        fields: [
          { label: "Provider", value: descriptor.displayName },
          { label: "Model", value: model ?? `${descriptor.defaultModel} (default)` },
          {
            label: "Config",
            value: changed.length === 0 ? "unchanged" : changed.join(", "),
          },
          {
            label: "Credential",
            value: credentialPresent
              ? `${descriptor.credentialEnv} set`
              : `${descriptor.credentialEnv} not set`,
            status: credentialPresent ? "pass" : "warn",
          },
        ],
        notes,
      },
    });
  },
};
