/**
 * Placeholder: the second capability, and the proof of the runtime.
 *
 * It has no domain, and it must never grow one. Its only job is to exercise
 * every axis a capability can declare — a command prefix, a config
 * namespace, a storage namespace, and user scope — through the exact
 * mechanisms Engineering uses, with the runtime never knowing the
 * difference between the two. It is not part of `defaultCapabilities`
 * (`src/capabilities/index.ts`); the real, shipped `orch` binary never
 * mentions it. Its only consumer is `tests/capabilities/placeholder.test.ts`,
 * which assembles it alongside Engineering and drives both through the real
 * CLI entry point, `run()` — not a simulation of the runtime, the runtime
 * itself, with a second capability actually registered. See ADR 0021.
 *
 * Both commands require user scope explicitly (`requires: { scope: "user"
 * }`), the way a real capability with no repository concept, like Home,
 * would declare every command it has. Run with no git repository anywhere
 * on disk, they still succeed.
 */
import { ok, requireScope } from "../../engine/command.js";
import { createCapabilityStorage } from "../../runtime/storage.js";
import type {
  CommandContext,
  CommandDefinition,
  CommandResult,
} from "../../engine/command.js";
import type { Capability, CapabilityConfigSchema } from "../../runtime/capability.js";
import type { FieldSpec } from "../../core/config/schema.js";

const CONFIG_SCHEMA: CapabilityConfigSchema = {
  namespace: "placeholder",
  fields: {
    greeting: {
      kind: "string",
      env: "ORCH_PLACEHOLDER_GREETING",
      description: "Greeting reported by `placeholder status`",
    } satisfies FieldSpec,
  },
  defaults: { greeting: "hello" },
};

/** Storage namespace. Happens to equal the command prefix below, which is
 *  allowed but not required — they are independent fields precisely so a
 *  future capability could choose differently. See ADR 0019. */
const STORAGE_NAMESPACE = "placeholder";

interface PingData {
  /** Times `ping` has been called, persisted in this capability's own
   *  storage across invocations. */
  readonly count: number;
  readonly storageRoot: string;
}

const pingCommand: CommandDefinition<PingData> = {
  name: "ping",
  summary: "Increment a counter in this capability's own storage",
  requires: { scope: "user" },

  execute(context: CommandContext): Promise<CommandResult<PingData>> {
    const scope = requireScope(context);
    const storage = createCapabilityStorage(scope, STORAGE_NAMESPACE, context.hosts.fs);

    const previous = storage.exists("pings.json")
      ? (JSON.parse(storage.readFile("pings.json")) as { count: number }).count
      : 0;
    const count = previous + 1;
    storage.writeFile("pings.json", JSON.stringify({ count }));

    return Promise.resolve(
      ok(
        { count, storageRoot: storage.root },
        {
          fields: [
            { label: "Count", value: count },
            { label: "Storage", value: storage.root },
          ],
        },
      ),
    );
  },
};

interface StatusData {
  readonly scope: "user";
  readonly greeting: string;
}

const statusCommand: CommandDefinition<StatusData> = {
  name: "status",
  summary: "Report this capability's own resolved scope and configuration",
  requires: { scope: "user" },

  execute(context: CommandContext): Promise<CommandResult<StatusData>> {
    // Named `status`, deliberately colliding in bare name with Engineering's
    // own `orch status`. Prefixed to `placeholder status`, it does not
    // collide in the registry — the proof that namespacing, not uniqueness
    // of intent, is what keeps two capabilities apart.
    const scope = requireScope(context);
    const greeting = String(CONFIG_SCHEMA.defaults["greeting"]);

    return Promise.resolve(
      ok(
        { scope: scope.kind as "user", greeting },
        {
          fields: [
            { label: "Scope", value: scope.kind },
            { label: "Greeting", value: greeting },
          ],
        },
      ),
    );
  },
};

export const placeholderCapability: Capability = {
  id: "placeholder",
  summary:
    "Proof-only second capability: exercises user scope, its own config namespace, and its own storage namespace. No domain, never shipped.",
  commandPrefix: "placeholder",
  storageNamespace: STORAGE_NAMESPACE,
  commands(): readonly CommandDefinition[] {
    return [pingCommand, statusCommand];
  },
  configSchema(): CapabilityConfigSchema {
    return CONFIG_SCHEMA;
  },
};
