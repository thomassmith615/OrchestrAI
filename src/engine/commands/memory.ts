/**
 * `orch memory` inspects project memory, and `orch memory add` writes to it.
 *
 * Memory that cannot be read is memory nobody trusts, and memory a human
 * cannot add to is a log rather than a shared record. Both halves matter.
 */
import {
  appendMemory,
  compactMemory,
  defaultRetriever,
  describeRecord,
  isMemoryKind,
  MEMORY_KINDS,
  nextMemoryId,
  readMemory,
} from "../../memory/index.js";
import { readGitStatus } from "../../repo/index.js";
import { EXIT_CODES, UsageError } from "../../core/errors.js";
import { attempt, requireWorkspace } from "../command.js";
import type { MemoryKind, MemoryRecord } from "../../memory/index.js";
import type { CommandContext, CommandDefinition, CommandResult, ReportField } from "../command.js";

export interface MemoryData {
  readonly total: number;
  readonly damaged: readonly number[];
  readonly records: readonly MemoryRecord[];
  readonly query: string | null;
}

function timestamp(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export const memoryCommand: CommandDefinition<MemoryData> = {
  name: "memory",
  summary: "Inspect project memory",
  args: [
    {
      name: "query",
      description: "Search terms; omit to list the most recent records",
      required: false,
    },
  ],
  options: [
    { flags: "--limit <count>", description: "How many records to show (default 10)" },
    { flags: "--kind <kind>", description: `Filter by kind: ${MEMORY_KINDS.join(", ")}` },
    { flags: "--full", description: "Include the body of each record" },
  ],
  requires: { repository: true, initialized: true },

  execute(context: CommandContext): Promise<CommandResult<MemoryData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const { records, damaged } = readMemory(
        context.hosts.fs,
        workspace.stateDir,
      );

      const limitOption = context.options["limit"];
      const limit =
        typeof limitOption === "string" ? Number.parseInt(limitOption, 10) : 10;

      const kindOption = context.options["kind"];
      const filtered =
        typeof kindOption === "string" && isMemoryKind(kindOption)
          ? records.filter((record) => record.kind === kindOption)
          : records;

      const query = context.args[0] ?? null;

      const selected =
        query === null
          ? [...filtered]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, Number.isNaN(limit) ? 10 : limit)
          : defaultRetriever
              .search(query, filtered, {
                limit: Number.isNaN(limit) ? 10 : limit,
                now: context.hosts.clock.now(),
              })
              .map((entry) => entry.record);

      const ranked =
        query === null
          ? null
          : defaultRetriever.search(query, filtered, {
              limit: Number.isNaN(limit) ? 10 : limit,
              now: context.hosts.clock.now(),
            });

      const fields: ReportField[] = selected.map((record, index) => ({
        label: record.id,
        value:
          ranked === null
            ? describeRecord(record)
            : `${describeRecord(record)}  [${ranked[index]?.reasons.join("; ") ?? ""}]`,
      }));

      const notes: string[] = [];
      if (records.length === 0) {
        notes.push("Memory is empty.");
      } else if (selected.length === 0) {
        notes.push(`Nothing matched ${String(query)}.`);
      }
      if (damaged.length > 0) {
        notes.push(
          `${String(damaged.length)} unreadable line(s) at ${damaged.join(", ")}.`,
        );
      }
      if (context.options["full"] === true) {
        for (const record of selected) {
          notes.push("", `--- ${record.id} ${record.title} ---`, record.body);
        }
      }

      return {
        data: {
          total: records.length,
          damaged,
          records: selected,
          query,
        },
        report: {
          fields: [
            { label: "Records", value: `${String(records.length)} total` },
            ...fields,
          ],
          ...(notes.length > 0 ? { notes } : {}),
        },
        exitCode: damaged.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success,
      };
    });
  },
};

export interface MemoryAddData {
  readonly record: MemoryRecord;
}

export const memoryAddCommand: CommandDefinition<MemoryAddData> = {
  name: "memory add",
  summary: "Record a decision, constraint, or note",
  args: [{ name: "title", description: "One line summary" }],
  options: [
    { flags: "--kind <kind>", description: `One of: ${MEMORY_KINDS.join(", ")}` },
    { flags: "--body <text>", description: "Rationale, in full" },
    { flags: "--tags <list>", description: "Comma separated tags" },
  ],
  requires: { repository: true, initialized: true },

  execute(context: CommandContext): Promise<CommandResult<MemoryAddData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const title = (context.args[0] ?? "").trim();

      if (title.length === 0) {
        throw new UsageError("A title is required");
      }

      const kindOption = context.options["kind"];
      if (typeof kindOption === "string" && !isMemoryKind(kindOption)) {
        throw new UsageError(
          `Unknown kind: ${kindOption}`,
          `Use one of: ${MEMORY_KINDS.join(", ")}`,
        );
      }
      const kind: MemoryKind =
        typeof kindOption === "string" && isMemoryKind(kindOption)
          ? kindOption
          : "decision";

      const bodyOption = context.options["body"];
      const tagsOption = context.options["tags"];
      const git = readGitStatus(context.hosts.proc, workspace.root);

      const record: MemoryRecord = {
        id: nextMemoryId(
          context.hosts.clock.now(),
          readMemory(context.hosts.fs, workspace.stateDir).records,
        ),
        kind,
        createdAt: context.hosts.clock.now(),
        title,
        body: typeof bodyOption === "string" ? bodyOption : "",
        tags:
          typeof tagsOption === "string"
            ? tagsOption
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0)
            : [],
        milestoneId: null,
        commit: git.head?.sha ?? null,
        source: "human",
      };

      appendMemory(context.hosts.fs, workspace.stateDir, record);

      return {
        data: { record },
        report: {
          fields: [
            { label: "Recorded", value: record.id },
            { label: "Kind", value: record.kind },
            { label: "Title", value: record.title },
            {
              label: "Commit",
              value: record.commit === null ? null : record.commit.slice(0, 7),
            },
            { label: "Date", value: timestamp(record.createdAt) },
          ],
        },
      };
    });
  },
};

export interface MemoryVerifyData {
  readonly records: number;
  readonly damaged: readonly number[];
  readonly duplicates: readonly string[];
  readonly healthy: boolean;
}

export const memoryVerifyCommand: CommandDefinition<MemoryVerifyData> = {
  name: "memory verify",
  summary: "Check project memory for damaged or duplicated records",
  requires: { repository: true, initialized: true },

  execute(context: CommandContext): Promise<CommandResult<MemoryVerifyData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const { records, damaged } = readMemory(
        context.hosts.fs,
        workspace.stateDir,
      );

      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const record of records) {
        if (seen.has(record.id)) {
          duplicates.push(record.id);
        }
        seen.add(record.id);
      }

      const healthy = damaged.length === 0 && duplicates.length === 0;

      return {
        data: { records: records.length, damaged, duplicates, healthy },
        report: {
          fields: [
            { label: "Records", value: records.length },
            {
              label: "Damaged",
              value:
                damaged.length === 0
                  ? "none"
                  : `lines ${damaged.join(", ")}`,
              status: damaged.length === 0 ? "pass" : "fail",
            },
            {
              label: "Duplicates",
              value: duplicates.length === 0 ? "none" : duplicates.join(", "),
              status: duplicates.length === 0 ? "pass" : "warn",
            },
          ],
          ...(healthy ? {} : { notes: ["Run `orch memory compact` to repair."] }),
        },
        exitCode: healthy ? EXIT_CODES.success : EXIT_CODES.failure,
      };
    });
  },
};

export interface MemoryCompactData {
  readonly before: number;
  readonly after: number;
  readonly removedDamaged: number;
  readonly removedDuplicate: number;
  readonly archivedTo: string;
}

export const memoryCompactCommand: CommandDefinition<MemoryCompactData> = {
  name: "memory compact",
  summary: "Rewrite memory, dropping damaged and duplicated records",
  requires: { repository: true, initialized: true },

  execute(context: CommandContext): Promise<CommandResult<MemoryCompactData>> {
    return attempt(() => {
      const workspace = requireWorkspace(context);
      const result = compactMemory(
        context.hosts.fs,
        workspace.stateDir,
        context.hosts.clock.now(),
      );

      return {
        data: result,
        report: {
          fields: [
            { label: "Lines before", value: result.before },
            { label: "Records after", value: result.after },
            { label: "Damaged dropped", value: result.removedDamaged },
            { label: "Duplicates dropped", value: result.removedDuplicate },
            { label: "Archived", value: result.archivedTo },
          ],
        },
      };
    });
  },
};
