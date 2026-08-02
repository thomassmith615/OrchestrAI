/**
 * Plugin contract.
 *
 * A plugin extends the workflow without forking it. It declares what it needs
 * before it is loaded, and the loader hands it only the capabilities it asked
 * for.
 *
 * On the limits of that enforcement, stated plainly: plugins run in this
 * process. A plugin that imports `node:fs` directly bypasses the host it was
 * given. Permissions are therefore a contract and a disclosure, not a sandbox.
 * `orch plugins` prints what each one asked for so the decision to trust it is
 * made with the facts visible. Real isolation needs a separate process and is
 * out of scope for Version 1.
 */
import type { Hosts } from "../core/hosts.js";
import type { Logger } from "../core/logger.js";
import type { CommandDefinition } from "../engine/command.js";
import type { Step } from "../workflow/steps.js";
import type { WorkflowRun } from "../workflow/run.js";

export const PERMISSIONS = [
  "read-repo",
  "write-repo",
  "network",
  "state",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Where a plugin's step is spliced into the built-in workflow. */
export interface StepPlacement {
  /** Name of the built-in step to insert after. */
  readonly after: string;
  readonly step: Step;
}

export interface PluginHooks {
  /** Called after a workflow run finishes, successfully or not. */
  onRunComplete?(run: WorkflowRun): void | Promise<void>;
}

export interface PluginContext {
  /** Only the capabilities the plugin declared. */
  readonly hosts: Partial<Hosts>;
  readonly logger: Logger;
  readonly root: string;
}

export interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly permissions: readonly Permission[];
  readonly commands?: readonly CommandDefinition[];
  readonly steps?: readonly StepPlacement[];
  readonly hooks?: PluginHooks;
  /** Called once after loading, with the granted capabilities. */
  setup?(context: PluginContext): void | Promise<void>;
}

export function isPlugin(value: unknown): value is Plugin {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Plugin>;

  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.version === "string" &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every(
      (entry) => typeof entry === "string" && isPermission(entry),
    )
  );
}
