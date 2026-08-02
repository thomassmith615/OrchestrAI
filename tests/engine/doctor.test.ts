import { describe, expect, it } from "vitest";
import { doctorCommand } from "../../src/engine/commands/doctor.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { ConfigurationError, resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { Check } from "../../src/engine/commands/doctor.js";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: "/repo/orchestrai.config.json",
  initialized: true,
};

function statusOf(checks: readonly Check[], name: string): string | undefined {
  return checks.find((check) => check.name === name)?.status;
}

function healthyConfig(): ReturnType<typeof resolveConfig> {
  const fs = fakeFileSystem({
    "/repo/orchestrai.config.json": JSON.stringify({ provider: "anthropic" }),
  });
  return resolveConfig({
    configPath: "/repo/orchestrai.config.json",
    fs,
    env: {},
  });
}

describe("doctorCommand", () => {
  it("passes when the environment is complete", async () => {
    const result = await doctorCommand.execute(
      fakeContext({
        workspace,
        config: healthyConfig(),
        hosts: fakeHosts({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
      }),
    );

    expect(result.data.healthy).toBe(true);
    expect(result.data.failures).toBe(0);
    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(statusOf(result.data.checks, "Credentials")).toBe("pass");
  });

  it("fails with the precondition code outside a repository", async () => {
    const result = await doctorCommand.execute(fakeContext({ config: null }));

    expect(result.exitCode).toBe(EXIT_CODES.precondition);
    expect(statusOf(result.data.checks, "Repository")).toBe("fail");
  });

  it("warns rather than fails when not yet initialized", async () => {
    const result = await doctorCommand.execute(
      fakeContext({
        workspace: { ...workspace, initialized: false },
        config: healthyConfig(),
      }),
    );

    expect(statusOf(result.data.checks, "Initialized")).toBe("warn");
    expect(result.data.failures).toBe(0);
  });

  it("reports an unusable config as a failure instead of throwing", async () => {
    const result = await doctorCommand.execute(
      fakeContext({
        workspace,
        config: null,
        configError: new ConfigurationError("provider must be a non-empty string"),
      }),
    );

    expect(statusOf(result.data.checks, "Config")).toBe("fail");
    expect(result.exitCode).toBe(EXIT_CODES.precondition);
  });

  it("fails when git is unavailable", async () => {
    const result = await doctorCommand.execute(
      fakeContext({
        workspace,
        config: healthyConfig(),
        hosts: fakeHosts({ proc: fakeProcess({ ok: false }) }),
      }),
    );

    expect(statusOf(result.data.checks, "Git")).toBe("fail");
    expect(result.data.healthy).toBe(false);
  });

  it("declares no requirements so it can diagnose a broken setup", () => {
    expect(doctorCommand.requires).toBeUndefined();
  });

  it("reports the active scope without treating it as a failure", async () => {
    const result = await doctorCommand.execute(
      fakeContext({
        workspace,
        config: healthyConfig(),
        hosts: fakeHosts({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
        scope: { kind: "repository", workspace },
      }),
    );

    expect(result.data.scope).toBe("repository");
    expect(statusOf(result.data.checks, "Scope")).toBe("pass");
    expect(result.data.failures).toBe(0);
  });

  it("warns rather than fails when no scope resolves at all", async () => {
    const result = await doctorCommand.execute(fakeContext({ scope: null }));

    expect(result.data.scope).toBeNull();
    expect(statusOf(result.data.checks, "Scope")).toBe("warn");
  });
});
