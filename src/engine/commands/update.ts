/**
 * `orch update` reports the installed version against the published one.
 *
 * It does not install anything. A tool that silently replaces itself is a tool
 * you cannot reason about, and the installer already knows how to upgrade a
 * package. This says whether you should.
 */
import { packageName, packageVersion } from "../../core/manifest.js";
import { EXIT_CODES } from "../../core/errors.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

const REGISTRY = "https://registry.npmjs.org";

export interface UpdateData {
  readonly current: string;
  readonly latest: string | null;
  readonly outdated: boolean;
  readonly checked: boolean;
}

/** Compares dotted numeric versions, ignoring any prerelease suffix. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (value: string): number[] =>
    value
      .split("-")[0]
      ?.split(".")
      .map((part) => Number.parseInt(part, 10) || 0) ?? [];

  const left = parse(candidate);
  const right = parse(current);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }

  return false;
}

export const updateCommand: CommandDefinition<UpdateData> = {
  name: "update",
  summary: "Report whether a newer Orchestrai has been published",
  options: [
    { flags: "--offline", description: "Skip the registry check" },
  ],

  async execute(context: CommandContext): Promise<CommandResult<UpdateData>> {
    const current = packageVersion();

    if (context.options["offline"] === true) {
      return {
        data: { current, latest: null, outdated: false, checked: false },
        report: { fields: [{ label: "Installed", value: current }] },
      };
    }

    let latest: string | null = null;

    try {
      const response = await context.hosts.http.send({
        url: `${REGISTRY}/${packageName()}/latest`,
        method: "GET",
        headers: { accept: "application/json" },
        body: "",
        timeoutMs: 10_000,
      });

      if (response.ok) {
        const parsed = JSON.parse(await response.text()) as { version?: string };
        latest = typeof parsed.version === "string" ? parsed.version : null;
      }
    } catch {
      latest = null;
    }

    const outdated = latest !== null && isNewer(latest, current);

    return {
      data: { current, latest, outdated, checked: latest !== null },
      report: {
        fields: [
          { label: "Installed", value: current },
          {
            label: "Published",
            value: latest ?? "could not reach the registry",
            status: latest === null ? "warn" : outdated ? "warn" : "pass",
          },
        ],
        notes: outdated
          ? [`Update with: npm install -g ${packageName()}@${latest ?? "latest"}`]
          : [],
      },
      exitCode: EXIT_CODES.success,
    };
  },
};
