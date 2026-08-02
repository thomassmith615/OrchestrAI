import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/run.js";
import { createLogger } from "../../src/core/logger.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { CommandRegistry } from "../../src/engine/registry.js";
import { ok } from "../../src/engine/command.js";
import { fakeFileSystem, fakeHosts } from "../support/fakes.js";
import type { Hosts } from "../../src/core/hosts.js";
import type { LogSink } from "../../src/core/logger.js";

interface RecordingSink extends LogSink {
  readonly lines: string[];
  text(): string;
}

function recordingSink(): RecordingSink {
  const lines: string[] = [];
  return {
    lines,
    write(line: string): void {
      lines.push(line);
    },
    text(): string {
      return lines.join("\n");
    },
  };
}

function harness(registry?: CommandRegistry, hosts?: Hosts): {
  out: RecordingSink;
  err: RecordingSink;
  invoke: (...argv: string[]) => Promise<number>;
} {
  const out = recordingSink();
  const err = recordingSink();
  const logger = createLogger({ level: "debug", out, err });

  return {
    out,
    err,
    invoke: (...argv: string[]) =>
      run({
        argv,
        logger,
        cwd: "/workspace/demo",
        hosts: hosts ?? fakeHosts(),
        ...(registry === undefined ? {} : { registry }),
      }),
  };
}

describe("run", () => {
  it("prints the version and exits successfully", async () => {
    const { out, invoke } = harness();

    expect(await invoke("--version")).toBe(EXIT_CODES.success);
    expect(out.text()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("names the binary orch in help output", async () => {
    const { out, invoke } = harness();

    expect(await invoke("--help")).toBe(EXIT_CODES.success);
    expect(out.text()).toContain("orch");
    expect(out.text()).toContain("info");
    expect(out.text()).toContain("--json");
  });

  it("renders aligned human output by default", async () => {
    const { out, invoke } = harness();

    expect(await invoke("info")).toBe(EXIT_CODES.success);
    expect(out.text()).toMatch(/Directory:\s+\/workspace\/demo/);
  });

  it("emits JSON when --json is supplied after the command", async () => {
    const { out, invoke } = harness();

    expect(await invoke("info", "--json")).toBe(EXIT_CODES.success);
    expect(JSON.parse(out.text())).toMatchObject({
      name: "orchestrai",
      workingDirectory: "/workspace/demo",
    });
  });

  it("honours --cwd", async () => {
    const { out, invoke } = harness();

    await invoke("info", "--json", "--cwd", "/tmp/other");

    expect(JSON.parse(out.text())).toMatchObject({
      workingDirectory: "/tmp/other",
    });
  });

  it("returns the usage exit code for an unknown command", async () => {
    const { err, invoke } = harness();

    expect(await invoke("teleport")).toBe(EXIT_CODES.usage);
    expect(err.text()).toContain("teleport");
  });

  it("propagates a command exit code", async () => {
    const registry = new CommandRegistry().register({
      name: "gate",
      summary: "Fails a validation gate",
      execute: () =>
        Promise.resolve({
          ...ok({ passed: false }, { fields: [{ label: "Tests", value: false, status: "fail" as const }] }),
          exitCode: EXIT_CODES.validation,
        }),
    });
    const { out, invoke } = harness(registry);

    expect(await invoke("gate")).toBe(EXIT_CODES.validation);
    expect(out.text()).toContain("Tests:  FAIL");
  });

  it("reports failures as JSON when --json is active", async () => {
    const registry = new CommandRegistry().register({
      name: "boom",
      summary: "Always throws",
      execute: () => Promise.reject(new Error("exploded")),
    });
    const { err, invoke } = harness(registry);

    expect(await invoke("boom", "--json")).toBe(EXIT_CODES.failure);
    expect(JSON.parse(err.text())).toMatchObject({
      error: { code: "internal.unexpected", message: "exploded" },
    });
  });

  it("passes positional arguments and options to the command", async () => {
    let received: { args: readonly string[]; force: unknown } | undefined;
    const registry = new CommandRegistry().register({
      name: "provider",
      summary: "Test argument passing",
      args: [{ name: "name", description: "Provider name" }],
      options: [{ flags: "--force", description: "Overwrite" }],
      execute: (context) => {
        received = { args: context.args, force: context.options["force"] };
        return Promise.resolve(ok({}, { fields: [] }));
      },
    });
    const { invoke } = harness(registry);

    expect(await invoke("provider", "anthropic", "--force")).toBe(
      EXIT_CODES.success,
    );
    expect(received).toEqual({ args: ["anthropic"], force: true });
  });

  it("reports the activated capabilities through the default registry", async () => {
    const { out, invoke } = harness();

    expect(await invoke("capabilities", "--json")).toBe(EXIT_CODES.success);
    const data = JSON.parse(out.text()) as {
      activated: { id: string; commandPrefix: string; commands: string[] }[];
      failed: unknown[];
    };

    expect(data.failed).toEqual([]);
    expect(data.activated).toHaveLength(1);
    expect(data.activated[0]).toMatchObject({ id: "engineering", commandPrefix: "" });
    expect(data.activated[0]?.commands).toContain("status");
  });

  it("exits 4 when a command requires a repository and none exists", async () => {
    const { err, invoke } = harness();

    expect(await invoke("init")).toBe(EXIT_CODES.precondition);
    expect(err.text()).toContain("Not inside a git repository");
  });

  it("exits 4 for a command declaring nothing but relying on the default scope", async () => {
    // No `requires` field at all means scope-agnostic (matches `info` and
    // `doctor`); a `requires` object with no `scope` defaults to
    // "repository" and must still fail outside one. See ADR 0017.
    const registry = new CommandRegistry().register({
      name: "needs-repo",
      summary: "Declares requires without a scope",
      requires: {},
      execute: () => Promise.resolve(ok({}, { fields: [] })),
    });
    const { err, invoke } = harness(registry);

    expect(await invoke("needs-repo")).toBe(EXIT_CODES.precondition);
    expect(err.text()).toContain("Not inside a git repository");
  });

  it("succeeds for a command declaring user scope with no repository anywhere", async () => {
    const registry = new CommandRegistry().register({
      name: "needs-home",
      summary: "Declares user scope",
      requires: { scope: "user" },
      execute: (context) =>
        Promise.resolve(
          ok(
            { scope: context.scope, workspace: context.workspace },
            { fields: [] },
          ),
        ),
    });
    const hosts = fakeHosts({ env: { HOME: "/Users/demo" } });
    const { out, invoke } = harness(registry, hosts);

    expect(await invoke("needs-home", "--json")).toBe(EXIT_CODES.success);
    const data = JSON.parse(out.text()) as {
      scope: { kind: string; root: string } | null;
      workspace: unknown;
    };
    expect(data.workspace).toBeNull();
    expect(data.scope).toEqual({
      kind: "user",
      root: "/Users/demo/.orchestrai",
      stateDir: "/Users/demo/.orchestrai",
    });
  });

  it("exits 5 when the config file is unreadable", async () => {
    const hosts = fakeHosts({
      fs: fakeFileSystem({
        "/workspace/demo/.git/HEAD": "",
        "/workspace/demo/orchestrai.config.json": "{ broken",
      }),
    });
    const { invoke } = harness(undefined, hosts);

    expect(await invoke("config")).toBe(EXIT_CODES.configuration);
  });

  it("runs init then config end to end", async () => {
    const fs = fakeFileSystem({ "/workspace/demo/.git/HEAD": "" });
    const { out, invoke } = harness(undefined, fakeHosts({ fs }));

    expect(await invoke("init")).toBe(EXIT_CODES.success);
    expect(fs.files.has("/workspace/demo/orchestrai.config.json")).toBe(true);

    out.lines.length = 0;
    expect(await invoke("config", "--json")).toBe(EXIT_CODES.success);
    expect(JSON.parse(out.text())).toMatchObject({
      values: { provider: "anthropic" },
      sources: { provider: "file" },
    });
  });

  it("applies --set overrides at the highest precedence", async () => {
    const fs = fakeFileSystem({
      "/workspace/demo/.git/HEAD": "",
      "/workspace/demo/orchestrai.config.json": '{"provider":"openai"}',
    });
    const { out, invoke } = harness(undefined, fakeHosts({ fs }));

    await invoke("config", "--json", "--set", "provider=gemini");

    expect(JSON.parse(out.text())).toMatchObject({
      values: { provider: "gemini" },
      sources: { provider: "flag" },
    });
  });

  it("omits optional arguments instead of passing the string undefined", async () => {
    let received: readonly string[] | undefined;
    const registry = new CommandRegistry().register({
      name: "optional",
      summary: "Takes an optional argument",
      args: [{ name: "focus", description: "Optional", required: false }],
      execute: (context) => {
        received = context.args;
        return Promise.resolve(ok({}, { fields: [] }));
      },
    });
    const { invoke } = harness(registry);

    await invoke("optional");

    expect(received).toEqual([]);
  });
});
