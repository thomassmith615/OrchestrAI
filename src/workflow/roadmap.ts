/**
 * Roadmap parsing.
 *
 * The roadmap is a markdown checklist that a human maintains and reads. It is
 * not a database, and it must not become one: if keeping the file parseable
 * ever conflicts with keeping it readable, readability wins and the parser
 * gets more tolerant.
 *
 * Recognized shapes:
 *
 *   - [x] **M1. Title**
 *     Indented body describing the objective.
 *   - [ ] Title without a number
 *
 * Anything else is ignored rather than treated as an error.
 */
import { join } from "node:path";
import type { FileSystemHost } from "../core/hosts.js";

export interface Milestone {
  /** Stable identifier: the declared number when present, else the index. */
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly complete: boolean;
  /** Indented lines beneath the checklist item, trimmed. */
  readonly body: string;
  /** Nearest preceding heading, e.g. "Part 2: make it useful". */
  readonly phase: string | null;
}

export interface Roadmap {
  /** Path relative to the repository root. */
  readonly path: string;
  readonly milestones: readonly Milestone[];
  readonly completed: number;
  readonly total: number;
  /** First incomplete milestone, or null when the roadmap is finished. */
  readonly current: Milestone | null;
}

export const EMPTY_ROADMAP: Roadmap = {
  path: "",
  milestones: [],
  completed: 0,
  total: 0,
  current: null,
};

const ITEM = /^-\s+\[( |x|X)\]\s+(.*)$/;
const HEADING = /^#{2,3}\s+(.*)$/;
const NUMBERED = /^\*\*M?(\d+)[.:)]?\s*(.*?)\*\*\s*$/;
const BOLD = /^\*\*(.*?)\*\*\s*$/;

function parseTitle(raw: string): { number: number | null; title: string } {
  const numbered = NUMBERED.exec(raw.trim());
  if (numbered !== null) {
    return {
      number: Number.parseInt(numbered[1] ?? "0", 10),
      title: (numbered[2] ?? "").trim(),
    };
  }

  const bold = BOLD.exec(raw.trim());
  if (bold !== null) {
    return { number: null, title: (bold[1] ?? "").trim() };
  }

  return { number: null, title: raw.trim() };
}

export function parseRoadmap(content: string, path: string): Roadmap {
  const lines = content.split("\n");
  const milestones: Milestone[] = [];

  let phase: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const heading = HEADING.exec(line);
    if (heading !== null) {
      phase = (heading[1] ?? "").trim();
      index += 1;
      continue;
    }

    const item = ITEM.exec(line);
    if (item === null) {
      index += 1;
      continue;
    }

    const complete = (item[1] ?? " ").toLowerCase() === "x";
    const { number, title } = parseTitle(item[2] ?? "");

    const body: string[] = [];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      // Body lines are indented; a blank line ends the item.
      if (next.trim().length === 0 || !/^\s+\S/.test(next)) {
        break;
      }
      body.push(next.trim());
      index += 1;
    }

    milestones.push({
      id: number === null ? String(milestones.length + 1) : String(number),
      number,
      title,
      complete,
      body: body.join(" ").trim(),
      phase,
    });
  }

  const completed = milestones.filter((milestone) => milestone.complete).length;

  return {
    path,
    milestones,
    completed,
    total: milestones.length,
    current: milestones.find((milestone) => !milestone.complete) ?? null,
  };
}

export function loadRoadmap(
  fs: FileSystemHost,
  root: string,
  relativePath: string,
): Roadmap {
  const absolute = join(root, relativePath);

  if (!fs.exists(absolute)) {
    return { ...EMPTY_ROADMAP, path: relativePath };
  }

  return parseRoadmap(fs.readFile(absolute), relativePath);
}

export function findMilestone(
  roadmap: Roadmap,
  id: string,
): Milestone | undefined {
  return roadmap.milestones.find((milestone) => milestone.id === id);
}

/** One line summary, e.g. `7 of 12 complete (58%)`. */
export function describeProgress(roadmap: Roadmap): string {
  if (roadmap.total === 0) {
    return "no milestones found";
  }

  const percent = Math.round((roadmap.completed / roadmap.total) * 100);

  return `${String(roadmap.completed)} of ${String(roadmap.total)} complete (${String(percent)}%)`;
}
