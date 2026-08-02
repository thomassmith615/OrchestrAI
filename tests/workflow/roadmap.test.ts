import { describe, expect, it } from "vitest";
import {
  describeProgress,
  findMilestone,
  loadRoadmap,
  parseRoadmap,
} from "../../src/workflow/index.js";
import { fakeFileSystem } from "../support/fakes.js";

const SAMPLE = `# Version 1 Roadmap

Some prose that is not a milestone.

## Part 1: foundation

- [x] **M1. Foundation and CLI shell**
  TypeScript project, strict settings, and the orch binary.
  Definition of Done is executable.

- [ ] **M2. Configuration**
  Layered configuration with source tracking.

## Part 2: usefulness

- [ ] **M3. Providers**
`;

describe("parseRoadmap", () => {
  it("extracts milestones with numbers, titles, and status", () => {
    const roadmap = parseRoadmap(SAMPLE, "docs/ROADMAP.md");

    expect(roadmap.total).toBe(3);
    expect(roadmap.completed).toBe(1);
    expect(roadmap.milestones[0]).toMatchObject({
      id: "1",
      number: 1,
      title: "Foundation and CLI shell",
      complete: true,
    });
  });

  it("captures the indented body as the objective", () => {
    const roadmap = parseRoadmap(SAMPLE, "docs/ROADMAP.md");

    expect(roadmap.milestones[0]?.body).toBe(
      "TypeScript project, strict settings, and the orch binary. Definition of Done is executable.",
    );
    expect(roadmap.milestones[2]?.body).toBe("");
  });

  it("records the nearest preceding heading as the phase", () => {
    const roadmap = parseRoadmap(SAMPLE, "docs/ROADMAP.md");

    expect(roadmap.milestones[0]?.phase).toBe("Part 1: foundation");
    expect(roadmap.milestones[2]?.phase).toBe("Part 2: usefulness");
  });

  it("treats the first incomplete milestone as current", () => {
    expect(parseRoadmap(SAMPLE, "x").current?.id).toBe("2");
  });

  it("reports no current milestone when everything is done", () => {
    const done = parseRoadmap("- [x] **M1. Done**\n", "x");

    expect(done.current).toBeNull();
    expect(describeProgress(done)).toBe("1 of 1 complete (100%)");
  });

  it("accepts unnumbered and unbolded items", () => {
    const roadmap = parseRoadmap("- [ ] Ship the thing\n", "x");

    expect(roadmap.milestones[0]).toMatchObject({
      id: "1",
      number: null,
      title: "Ship the thing",
    });
  });

  it("accepts an uppercase completion marker", () => {
    expect(parseRoadmap("- [X] **M1. Done**\n", "x").completed).toBe(1);
  });

  it("ignores prose, headings, and unrelated lists", () => {
    const roadmap = parseRoadmap(
      ["# Title", "Some prose.", "- a bullet", "1. numbered"].join("\n"),
      "x",
    );

    expect(roadmap.total).toBe(0);
    expect(describeProgress(roadmap)).toBe("no milestones found");
  });
});

describe("loadRoadmap", () => {
  it("reads the configured path", () => {
    const fs = fakeFileSystem({ "/repo/docs/ROADMAP.md": SAMPLE });

    expect(loadRoadmap(fs, "/repo", "docs/ROADMAP.md").total).toBe(3);
  });

  it("returns an empty roadmap when the file is missing", () => {
    const roadmap = loadRoadmap(fakeFileSystem(), "/repo", "docs/ROADMAP.md");

    expect(roadmap.total).toBe(0);
    expect(roadmap.path).toBe("docs/ROADMAP.md");
  });
});

describe("findMilestone", () => {
  it("looks up by id", () => {
    const roadmap = parseRoadmap(SAMPLE, "x");

    expect(findMilestone(roadmap, "2")?.title).toBe("Configuration");
    expect(findMilestone(roadmap, "99")).toBeUndefined();
  });
});
