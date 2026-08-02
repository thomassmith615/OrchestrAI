import { describe, expect, it } from "vitest";
import { executeWorkflow, listRuns, nextRunId, recordRun } from "../../src/workflow/index.js";
import { createLogger } from "../../src/core/logger.js";
import { fakeClock, fakeFileSystem, fakeHosts } from "../support/fakes.js";
import type { Step, StepContext, WorkflowRun } from "../../src/workflow/index.js";
import type { Toolchain } from "../../src/repo/index.js";

const TOOLCHAIN: Toolchain = {
  ecosystem: "node",
  packageManager: "npm",
  build: null,
  typecheck: null,
  lint: null,
  test: null,
  ci: null,
  manifests: [],
};

function step(name: string, overrides: Partial<Step> = {}): Step {
  return {
    name,
    description: `${name} step`,
    run: () => ({ status: "ok", detail: `${name} done` }),
    ...overrides,
  };
}

async function execute(
  steps: readonly Step[],
  dryRun = false,
): Promise<WorkflowRun> {
  return executeWorkflow({
    steps,
    dryRun,
    runId: "test-run",
    context: {
      root: "/repo",
      stateDir: "/repo/.orchestrai",
      hosts: fakeHosts({ clock: fakeClock() }),
      logger: createLogger({ level: "silent" }),
      toolchain: TOOLCHAIN,
      milestone: {
        id: "8",
        number: 8,
        title: "Workflow engine",
        complete: false,
        body: "Parse the roadmap",
        phase: null,
      },
    },
  });
}

describe("executeWorkflow", () => {
  it("runs steps in order and reports each one", async () => {
    const run = await execute([step("a"), step("b")]);

    expect(run.status).toBe("ok");
    expect(run.steps.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(run.steps.every((entry) => entry.status === "ok")).toBe(true);
    expect(run.milestoneId).toBe("8");
  });

  it("stops at the first failure and skips the rest", async () => {
    const run = await execute([
      step("a"),
      step("b", { run: () => ({ status: "failed", detail: "broke" }) }),
      step("c"),
    ]);

    expect(run.status).toBe("failed");
    expect(run.failedAt).toBe("b");
    expect(run.steps[2]).toMatchObject({
      status: "skipped",
      detail: "earlier step failed",
    });
  });

  it("skips a step whose precondition declines, without failing", async () => {
    const run = await execute([
      step("a", { precondition: () => "nothing to do" }),
      step("b"),
    ]);

    expect(run.status).toBe("ok");
    expect(run.steps[0]).toMatchObject({ status: "skipped", detail: "nothing to do" });
    expect(run.steps[1]?.status).toBe("ok");
  });

  it("fails a step whose postcondition rejects the result", async () => {
    const run = await execute([
      step("a", { postcondition: () => "result was unusable" }),
    ]);

    expect(run.status).toBe("failed");
    expect(run.steps[0]).toMatchObject({
      status: "failed",
      detail: "result was unusable",
    });
  });

  it("passes produced values to later steps", async () => {
    let seen: unknown;
    const run = await execute([
      step("a", {
        run: () => ({ status: "ok", detail: "produced", produces: { key: 42 } }),
      }),
      step("b", {
        run: (context: StepContext) => {
          seen = context.data.get("key");
          return { status: "ok", detail: "read it" };
        },
      }),
    ]);

    expect(seen).toBe(42);
    expect(run.status).toBe("ok");
  });

  it("converts a thrown error into a failed step", async () => {
    const run = await execute([
      step("a", {
        run: () => {
          throw new Error("exploded");
        },
      }),
    ]);

    expect(run.status).toBe("failed");
    expect(run.steps[0]?.detail).toBe("exploded");
  });

  it("lists every stage in a dry run, including ones that would skip", async () => {
    const run = await execute(
      [step("a", { precondition: () => "would skip" }), step("b")],
      true,
    );

    expect(run.steps.every((entry) => entry.detail === "dry run")).toBe(true);
  });

  it("executes nothing in a dry run", async () => {
    let ran = false;
    const run = await execute(
      [
        step("a", {
          run: () => {
            ran = true;
            return { status: "ok", detail: "ran" };
          },
        }),
      ],
      true,
    );

    expect(ran).toBe(false);
    expect(run.dryRun).toBe(true);
    expect(run.steps[0]).toMatchObject({ status: "skipped", detail: "dry run" });
  });
});

describe("run log", () => {
  it("records and lists runs newest first", async () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    const first = await execute([step("a")]);

    expect(recordRun(fs, "/repo/.orchestrai", first)).toBe(true);
    expect(
      recordRun(fs, "/repo/.orchestrai", {
        ...first,
        id: "later",
        startedAt: first.startedAt + 1000,
      }),
    ).toBe(true);

    expect(listRuns(fs, "/repo/.orchestrai").map((run) => run.id)).toEqual([
      "later",
      "test-run",
    ]);
  });

  it("does nothing without a state directory", async () => {
    const fs = fakeFileSystem();

    expect(recordRun(fs, "/repo/.orchestrai", await execute([step("a")]))).toBe(
      false,
    );
    expect(listRuns(fs, "/repo/.orchestrai")).toEqual([]);
  });

  it("ignores unreadable run files", () => {
    const fs = fakeFileSystem({
      "/repo/.orchestrai/runs/bad.json": "{ broken",
    });

    expect(listRuns(fs, "/repo/.orchestrai")).toEqual([]);
  });

  it("generates unique ids", () => {
    const first = nextRunId(1_700_000_000_000, []);

    expect(nextRunId(1_700_000_000_000, [first])).toContain("-1");
  });
});
