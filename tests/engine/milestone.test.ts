import { describe, expect, it } from "vitest";
import { milestoneCommand } from "../../src/engine/commands/milestone.js";
import { roadmapCommand } from "../../src/engine/commands/roadmap.js";
import { listRuns } from "../../src/workflow/index.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { CommandContext } from "../../src/engine/command.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: CONFIG_PATH,
  initialized: true,
};

const ROADMAP = [
  "## Part 1",
  "",
  "- [x] **M1. Foundation**",
  "  Scaffolding and gates.",
  "",
  "- [ ] **M2. Configuration**",
  "  Layered configuration with source tracking.",
  "",
  "- [ ] **M3. Providers**",
  "",
].join("\n");

const CLEAN_GIT = { "git status": { stdout: "# branch.head main" } };

function build(
  options: Record<string, unknown> = {},
  files: Record<string, string> = {},
  responses: Record<string, { stdout?: string; code?: number }> = CLEAN_GIT,
): { context: CommandContext; fs: FakeFileSystem } {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/.orchestrai/.gitignore": "cache/",
    "/repo/docs/ROADMAP.md": ROADMAP,
    "/repo/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "/repo/src/a.ts": "export const a = 1;\n",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock" }),
    ...files,
  });

  return {
    fs,
    context: fakeContext({
      workspace,
      options,
      hosts: fakeHosts({ fs, proc: fakeProcess({}, responses) }),
      config: resolveConfig({ configPath: CONFIG_PATH, fs, env: {} }),
    }),
  };
}

describe("roadmapCommand", () => {
  it("reports progress and marks the current milestone", async () => {
    const result = await roadmapCommand.execute(build().context);

    expect(result.data.total).toBe(3);
    expect(result.data.completed).toBe(1);
    expect(result.data.current?.id).toBe("2");
    expect(
      result.report.fields.some((field) =>
        String(field.value).includes("<- current"),
      ),
    ).toBe(true);
  });

  it("hides completed milestones unless --all is given", async () => {
    const brief = await roadmapCommand.execute(build().context);
    const full = await roadmapCommand.execute(build({ all: true }).context);

    expect(full.report.fields.length).toBeGreaterThan(brief.report.fields.length);
  });

  it("says so when the roadmap file is missing", async () => {
    const { context } = build({}, { "/repo/docs/ROADMAP.md": "" });
    const result = await roadmapCommand.execute(context);

    expect(result.data.total).toBe(0);
    expect(result.report.notes?.join(" ")).toContain("No milestones");
  });
});

describe("milestoneCommand", () => {
  it("runs the workflow for the current milestone", async () => {
    const { context, fs } = build();

    const result = await milestoneCommand.execute(context);

    expect(result.data.milestone?.id).toBe("2");
    expect(result.data.run.status).toBe("ok");
    expect(result.data.run.steps.map((step) => step.name)).toEqual([
      "understand",
      "analyze",
      "preflight",
      "baseline",
      "verify",
      "summarize",
    ]);
    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(listRuns(fs, "/repo/.orchestrai")).toHaveLength(1);
  });

  it("targets a specific milestone with --id", async () => {
    const result = await milestoneCommand.execute(build({ id: "3" }).context);

    expect(result.data.milestone?.title).toBe("Providers");
  });

  it("lists stages without executing them in a dry run", async () => {
    const { context, fs } = build({ dryRun: true });

    const result = await milestoneCommand.execute(context);

    expect(result.data.run.dryRun).toBe(true);
    expect(result.data.recorded).toBe(false);
    expect(result.data.run.steps.every((step) => step.status === "skipped")).toBe(
      true,
    );
    expect(listRuns(fs, "/repo/.orchestrai")).toHaveLength(0);
  });

  it("stops and exits 3 when the tree is dirty", async () => {
    const { context } = build({}, {}, {
      "git status": {
        stdout: "# branch.head main\n1 .M N... 1 1 1 a b src/a.ts",
      },
    });

    const result = await milestoneCommand.execute(context);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(result.data.run.failedAt).toBe("preflight");
    expect(
      result.data.run.steps.find((step) => step.name === "baseline")?.status,
    ).toBe("skipped");
  });

  it("fails the baseline when the repository is already red", async () => {
    const { context } = build({}, {}, {
      ...CLEAN_GIT,
      "npm test": { code: 1 },
    });

    const result = await milestoneCommand.execute(context);

    expect(result.data.run.failedAt).toBe("baseline");
    expect(
      result.data.run.steps.find((step) => step.name === "baseline")?.detail,
    ).toContain("already failing");
  });

  it("skips verification when nothing changed", async () => {
    const result = await milestoneCommand.execute(build().context);

    expect(
      result.data.run.steps.find((step) => step.name === "verify"),
    ).toMatchObject({ status: "skipped", detail: "no change was made in this run" });
  });

  it("fails when the roadmap has no pending milestone", async () => {
    const { context } = build({}, {
      "/repo/docs/ROADMAP.md": "- [x] **M1. Done**\n",
    });

    const result = await milestoneCommand.execute(context);

    expect(result.data.milestone).toBeNull();
    expect(result.data.run.failedAt).toBe("understand");
  });
});
