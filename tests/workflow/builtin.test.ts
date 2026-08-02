import { describe, expect, it } from "vitest";
import {
  MILESTONE_WORKFLOW,
  PREPARE_WORKFLOW,
  executeWorkflow,
} from "../../src/workflow/index.js";
import { readProposal } from "../../src/proposals/index.js";
import { createLogger } from "../../src/core/logger.js";
import { fakeClock, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { AiCall, AiReply, Step, WorkflowOutcome } from "../../src/workflow/index.js";
import type { Toolchain } from "../../src/repo/index.js";
import type { ProcessResult } from "../../src/core/hosts.js";

const TOOLCHAIN: Toolchain = {
  ecosystem: "node",
  packageManager: "npm",
  build: null,
  typecheck: null,
  lint: null,
  test: { command: "npm", args: ["test"] },
  ci: null,
  manifests: ["package.json"],
};

const CLEAN_GIT = { "git status": { stdout: "# branch.head main" } };

const PROPOSAL_REPLY = [
  "Adding the module.",
  "<<<FILE src/new.ts",
  "export const created = true;",
  ">>>",
].join("\n");

function reply(text: string): AiReply {
  return {
    text,
    provider: "mock",
    model: "mock-1",
    promptRef: "plan@1",
    contextTokens: 100,
    usage: { inputTokens: 10, outputTokens: 20 },
  };
}

interface Harness {
  readonly outcome: Promise<WorkflowOutcome>;
  readonly fs: FakeFileSystem;
  readonly calls: string[];
}

function run(
  steps: readonly Step[],
  options: {
    apply?: boolean;
    responses?: Record<string, { stdout?: string; code?: number }>;
    ai?: ((call: AiCall) => Promise<AiReply>) | null;
    files?: Record<string, string>;
  } = {},
): Harness {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/.orchestrai/.gitignore": "cache/",
    "/repo/package.json": "{}",
    "/repo/src/a.ts": "export const a = 1;\n",
    ...options.files,
  });

  const calls: string[] = [];
  const ai =
    options.ai === null
      ? undefined
      : (options.ai ??
        ((call: AiCall): Promise<AiReply> => {
          calls.push(call.promptId);
          return Promise.resolve(
            reply(call.promptId === "propose" ? PROPOSAL_REPLY : "A plan."),
          );
        }));

  return {
    fs,
    calls,
    outcome: executeWorkflow({
      steps,
      dryRun: false,
      runId: "run-1",
      context: {
        root: "/repo",
        stateDir: "/repo/.orchestrai",
        hosts: fakeHosts({
          fs,
          proc: fakeProcess({}, { ...CLEAN_GIT, ...options.responses }),
          clock: fakeClock(),
        }),
        logger: createLogger({ level: "silent" }),
        toolchain: TOOLCHAIN,
        milestone: {
          id: "9",
          number: 9,
          title: "End to end orchestration",
          complete: false,
          body: "Wire the loop together",
          phase: null,
        },
        apply: options.apply ?? false,
        ...(ai === undefined ? {} : { ai }),
      },
    }),
  };
}

describe("PREPARE_WORKFLOW", () => {
  it("ends at a plan and writes nothing", async () => {
    const harness = run(PREPARE_WORKFLOW);
    const before = new Map(harness.fs.files);
    const { run: result, data } = await harness.outcome;

    expect(result.status).toBe("ok");
    expect(result.steps.map((step) => step.name)).toEqual([
      "understand",
      "analyze",
      "preflight",
      "baseline",
      "plan",
      "summarize",
    ]);
    expect(data.get("plan")).toBe("A plan.");
    expect(harness.calls).toEqual(["plan"]);
    expect(harness.fs.files.size).toBe(before.size);
  });

  it("skips planning without a provider", async () => {
    const { run: result } = await run(PREPARE_WORKFLOW, { ai: null }).outcome;

    expect(result.status).toBe("ok");
    expect(result.steps.find((step) => step.name === "plan")).toMatchObject({
      status: "skipped",
      detail: "no provider available",
    });
  });

  it("fails when the provider returns an empty plan", async () => {
    const { run: result } = await run(PREPARE_WORKFLOW, {
      ai: () => Promise.resolve(reply("   ")),
    }).outcome;

    expect(result.failedAt).toBe("plan");
    expect(result.steps.find((step) => step.name === "plan")?.detail).toContain(
      "empty plan",
    );
  });
});

describe("MILESTONE_WORKFLOW", () => {
  it("plans, proposes, and stops before touching the tree", async () => {
    const harness = run(MILESTONE_WORKFLOW);
    const { run: result, data } = await harness.outcome;

    expect(harness.calls).toEqual(["plan", "propose"]);
    expect(result.status).toBe("ok");
    expect(data.has("proposal")).toBe(true);
    expect(harness.fs.files.has("/repo/src/new.ts")).toBe(false);

    expect(result.steps.find((step) => step.name === "apply")).toMatchObject({
      status: "skipped",
      detail: "staged for review, not applied",
    });
    expect(result.steps.find((step) => step.name === "verify")).toMatchObject({
      status: "skipped",
    });
  });

  it("stages the proposal for later review", async () => {
    const harness = run(MILESTONE_WORKFLOW);
    const { data } = await harness.outcome;
    const proposal = data.get("proposal") as { id: string };

    expect(readProposal(harness.fs, "/repo/.orchestrai", proposal.id)).toMatchObject(
      { status: "open", task: "Wire the loop together" },
    );
  });

  it("applies and verifies when the operator asks", async () => {
    const harness = run(MILESTONE_WORKFLOW, { apply: true });
    const { run: result } = await harness.outcome;

    expect(harness.fs.files.get("/repo/src/new.ts")).toContain("created");
    expect(result.steps.find((step) => step.name === "apply")?.status).toBe("ok");
    expect(result.steps.find((step) => step.name === "verify")?.status).toBe("ok");
    expect(result.status).toBe("ok");
  });

  it("stops at the baseline when the repository is already red", async () => {
    const harness = run(MILESTONE_WORKFLOW, {
      apply: true,
      responses: { "npm test": { code: 1 } },
    });
    const { run: result } = await harness.outcome;

    expect(result.failedAt).toBe("baseline");
    expect(harness.calls).toEqual([]);
  });

  it("fails verification when the applied change breaks the gates", async () => {
    const fs = fakeFileSystem({
      "/repo/.git/HEAD": "",
      "/repo/.orchestrai/.gitignore": "cache/",
      "/repo/package.json": "{}",
      "/repo/src/a.ts": "export const a = 1;\n",
    });

    // Green until the proposal lands, red afterwards: a real regression.
    const proc = {
      calls: [] as { command: string; args: readonly string[] }[],
      run: (command: string, args: readonly string[]): ProcessResult => {
        proc.calls.push({ command, args });
        const line = [command, ...args].join(" ");

        if (line.startsWith("git status")) {
          return { ok: true, code: 0, stdout: "# branch.head main", stderr: "", timedOut: false };
        }
        if (line === "npm test" && fs.files.has("/repo/src/new.ts")) {
          return { ok: false, code: 1, stdout: "", stderr: "broke", timedOut: false };
        }
        return { ok: true, code: 0, stdout: "", stderr: "", timedOut: false };
      },
    };

    const { run: result } = await executeWorkflow({
      steps: MILESTONE_WORKFLOW,
      dryRun: false,
      runId: "regression",
      context: {
        root: "/repo",
        stateDir: "/repo/.orchestrai",
        hosts: fakeHosts({ fs, proc, clock: fakeClock() }),
        logger: createLogger({ level: "silent" }),
        toolchain: TOOLCHAIN,
        milestone: {
          id: "9",
          number: 9,
          title: "End to end orchestration",
          complete: false,
          body: "Wire the loop together",
          phase: null,
        },
        apply: true,
        ai: (call: AiCall) =>
          Promise.resolve(
            reply(call.promptId === "propose" ? PROPOSAL_REPLY : "A plan."),
          ),
      },
    });

    expect(result.failedAt).toBe("verify");
    expect(result.steps.find((step) => step.name === "verify")?.detail).toContain(
      "regressed",
    );
  });

  it("stops at implement when the model proposes nothing", async () => {
    const { run: result } = await run(MILESTONE_WORKFLOW, {
      ai: (call: AiCall) =>
        Promise.resolve(
          reply(call.promptId === "propose" ? "I need to see the schema." : "A plan."),
        ),
    }).outcome;

    expect(result.failedAt).toBe("implement");
    expect(
      result.steps.find((step) => step.name === "implement")?.detail,
    ).toContain("no changes proposed");
  });

  it("never reaches the model when preflight fails", async () => {
    const harness = run(MILESTONE_WORKFLOW, {
      responses: {
        "git status": {
          stdout: "# branch.head main\n1 .M N... 1 1 1 a b src/a.ts",
        },
      },
    });
    const { run: result } = await harness.outcome;

    expect(result.failedAt).toBe("preflight");
    expect(harness.calls).toEqual([]);
  });
});
