/**
 * `orch capabilities` reports what the runtime activated.
 *
 * This is a runtime introspection command, not an application one, so it is
 * built here from an `ActivationResult` rather than declared by any
 * capability. It knows nothing about what a capability does, only what
 * activation already recorded.
 */
import { ok } from "../engine/command.js";
import type { CommandDefinition, CommandResult, ReportField } from "../engine/command.js";
import type { ActivationResult } from "./activate.js";

export interface CapabilitiesData {
  readonly activated: ActivationResult["activated"];
  readonly failed: ActivationResult["failed"];
}

export function buildCapabilitiesCommand(
  activation: ActivationResult,
): CommandDefinition<CapabilitiesData> {
  return {
    name: "capabilities",
    summary: "List the capabilities the runtime activated",

    execute(): Promise<CommandResult<CapabilitiesData>> {
      const fields: ReportField[] = [
        ...activation.activated.map((entry) => ({
          label: entry.id,
          value:
            `${entry.commandPrefix === "" ? "(no prefix)" : entry.commandPrefix} · ` +
            `${String(entry.commands.length)} command(s)`,
          status: "pass" as const,
        })),
        ...activation.failed.map((entry) => ({
          label: entry.id,
          value: entry.reason,
          status: "fail" as const,
        })),
      ];

      const notes =
        activation.failed.length > 0
          ? [`${String(activation.failed.length)} capability(ies) failed to activate.`]
          : [`${String(activation.activated.length)} capability(ies) activated.`];

      return Promise.resolve(
        ok({ activated: activation.activated, failed: activation.failed }, { fields, notes }),
      );
    },
  };
}
