/**
 * The dashboard's data model.
 *
 * Assembled from the same modules the CLI uses, so the two surfaces can never
 * disagree. Read only by construction: nothing here writes.
 */
import { detectToolchain, readGitStatus, scanRepository } from "../repo/index.js";
import { readGateRun } from "../gates/index.js";
import { readMemory, readUsage, totalUsage } from "../memory/index.js";
import { listRuns, loadRoadmap } from "../workflow/index.js";
import { listProposals } from "../proposals/index.js";
import type { Hosts } from "../core/hosts.js";
import type { Workspace } from "../core/workspace.js";

export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly repository: string;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly files: number;
  readonly ecosystem: string;
  readonly roadmap: {
    readonly completed: number;
    readonly total: number;
    readonly current: string | null;
  };
  readonly gates: readonly {
    readonly name: string;
    readonly status: string;
  }[];
  readonly runs: readonly {
    readonly id: string;
    readonly status: string;
    readonly milestone: string | null;
    readonly startedAt: number;
    readonly failedAt: string | null;
  }[];
  readonly proposals: readonly {
    readonly id: string;
    readonly status: string;
    readonly task: string;
    readonly files: number;
  }[];
  readonly memory: readonly {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
  }[];
  readonly usage: ReturnType<typeof totalUsage>;
}

export function buildSnapshot(
  workspace: Workspace,
  hosts: Hosts,
  roadmapPath: string,
): DashboardSnapshot {
  const git = readGitStatus(hosts.proc, workspace.root);
  const scan = scanRepository({ root: workspace.root, fs: hosts.fs });
  const toolchain = detectToolchain(hosts.fs, workspace.root);
  const roadmap = loadRoadmap(hosts.fs, workspace.root, roadmapPath);
  const gates = readGateRun(hosts.fs, workspace.stateDir);

  return {
    generatedAt: hosts.clock.now(),
    repository: workspace.root,
    branch: git.branch,
    dirty: git.dirty,
    files: scan.files.length,
    ecosystem: toolchain.ecosystem,
    roadmap: {
      completed: roadmap.completed,
      total: roadmap.total,
      current:
        roadmap.current === null
          ? null
          : `M${roadmap.current.id}: ${roadmap.current.title}`,
    },
    gates:
      gates === null
        ? []
        : gates.results.map((result) => ({
            name: result.name,
            status: result.status,
          })),
    runs: listRuns(hosts.fs, workspace.stateDir)
      .slice(0, 10)
      .map((run) => ({
        id: run.id,
        status: run.status,
        milestone: run.milestoneTitle,
        startedAt: run.startedAt,
        failedAt: run.failedAt,
      })),
    proposals: listProposals(hosts.fs, workspace.stateDir)
      .slice(0, 10)
      .map((proposal) => ({
        id: proposal.id,
        status: proposal.status,
        task: proposal.task,
        files: proposal.changes.length,
      })),
    memory: readMemory(hosts.fs, workspace.stateDir)
      .records.slice(-10)
      .reverse()
      .map((record) => ({
        id: record.id,
        kind: record.kind,
        title: record.title,
      })),
    usage: totalUsage(readUsage(hosts.fs, workspace.stateDir)),
  };
}
