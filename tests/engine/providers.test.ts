import { describe, expect, it } from "vitest";
import { providersCommand } from "../../src/engine/commands/providers.js";
import { providerAddCommand } from "../../src/engine/commands/provider-add.js";
import { resolveConfig } from "../../src/core/config/index.js";
import { fakeContext, fakeFileSystem, fakeHosts, fakeHttp } from "../support/fakes.js";
import type { FakeFileSystem } from "../support/fakes.js";
import type { ResolvedConfig } from "../../src/core/config/index.js";

const CONFIG_PATH = "/repo/orchestrai.config.json";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: CONFIG_PATH,
  initialized: true,
};

function configWith(
  fs: FakeFileSystem,
  env: Record<string, string> = {},
): ResolvedConfig {
  return resolveConfig({ configPath: CONFIG_PATH, fs, env });
}

function seed(values: Record<string, unknown> = {}): FakeFileSystem {
  return fakeFileSystem({
    "/repo/.git/HEAD": "",
    [CONFIG_PATH]: JSON.stringify({ provider: "mock", ...values }),
  });
}

describe("providersCommand", () => {
  it("marks the selected provider and reports credential presence", async () => {
    const fs = seed({ provider: "anthropic" });
    const result = await providersCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        hosts: fakeHosts({ fs, env: { ANTHROPIC_API_KEY: "sk-test" } }),
      }),
    );

    expect(result.data.selected).toBe("anthropic");
    const anthropic = result.data.providers.find((p) => p.id === "anthropic");
    expect(anthropic?.selected).toBe(true);
    expect(anthropic?.credentialPresent).toBe(true);
    expect(result.data.providers.find((p) => p.id === "mock")?.selected).toBe(
      false,
    );
  });

  it("warns rather than fails when a credential is absent", async () => {
    const fs = seed({ provider: "anthropic" });
    const result = await providersCommand.execute(
      fakeContext({ workspace, config: configWith(fs), hosts: fakeHosts({ fs }) }),
    );

    expect(result.report.fields.some((field) => field.status === "warn")).toBe(
      true,
    );
    // Listing never fails; a missing credential is a warning.
    expect(result.exitCode).toBe(0);
  });

  it("does not warn on ollama's missing credential, since none is required", async () => {
    const fs = seed({ provider: "ollama" });
    const result = await providersCommand.execute(
      fakeContext({ workspace, config: configWith(fs), hosts: fakeHosts({ fs }) }),
    );

    const ollama = result.data.providers.find((p) => p.id === "ollama");
    expect(ollama?.credentialPresent).toBe(false);
    expect(ollama?.credentialRequired).toBe(false);
    const field = result.report.fields.find((entry) => entry.label === "ollama *");
    expect(field?.status).toBe("pass");
    expect(field?.value).toContain("not required");
  });

  it("makes no requests unless --verify is passed", async () => {
    const fs = seed({ provider: "anthropic" });
    const http = fakeHttp();

    await providersCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        hosts: fakeHosts({ fs, http, env: { ANTHROPIC_API_KEY: "k" } }),
      }),
    );

    expect(http.requests).toHaveLength(0);
  });

  it("verifies only the selected provider when asked", async () => {
    const fs = seed({ provider: "anthropic" });
    const http = fakeHttp({
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 4, output_tokens: 1 },
      }),
    });

    const result = await providersCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        options: { verify: true },
        hosts: fakeHosts({ fs, http, env: { ANTHROPIC_API_KEY: "k" } }),
      }),
    );

    expect(http.requests).toHaveLength(1);
    expect(result.data.providers.find((p) => p.id === "anthropic")?.reachable).toBe(
      true,
    );
    expect(result.data.providers.find((p) => p.id === "mock")?.reachable).toBeUndefined();
  });

  it("reports a failed verification without throwing", async () => {
    const fs = seed({ provider: "anthropic" });
    const http = fakeHttp({ status: 401, body: '{"error":{"message":"bad key"}}' });

    const result = await providersCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        options: { verify: true },
        hosts: fakeHosts({ fs, http, env: { ANTHROPIC_API_KEY: "wrong" } }),
      }),
    );

    const entry = result.data.providers.find((p) => p.id === "anthropic");
    expect(entry?.reachable).toBe(false);
    expect(entry?.detail).toContain("bad key");
    // Credential failures propagate the configuration exit code.
    expect(result.exitCode).toBe(5);
  });
});

describe("providerAddCommand", () => {
  it("writes the provider and preserves unrelated settings", async () => {
    const fs = seed({ roadmapPath: "docs/PLAN.md" });

    const result = await providerAddCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        args: ["anthropic"],
        hosts: fakeHosts({ fs }),
      }),
    );

    const written = JSON.parse(fs.files.get(CONFIG_PATH) ?? "{}") as Record<
      string,
      unknown
    >;

    expect(written["provider"]).toBe("anthropic");
    expect(written["roadmapPath"]).toBe("docs/PLAN.md");
    expect(result.data.changed).toEqual(["provider"]);
  });

  it("pins a model when --model is supplied", async () => {
    const fs = seed();

    await providerAddCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        args: ["anthropic"],
        options: { model: "claude-opus-5" },
        hosts: fakeHosts({ fs }),
      }),
    );

    expect(
      (JSON.parse(fs.files.get(CONFIG_PATH) ?? "{}") as Record<string, unknown>)[
        "model"
      ],
    ).toBe("claude-opus-5");
  });

  it("reports no change when the provider is already selected", async () => {
    const fs = seed({ provider: "anthropic" });

    const result = await providerAddCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        args: ["anthropic"],
        hosts: fakeHosts({ fs }),
      }),
    );

    expect(result.data.changed).toEqual([]);
  });

  it("never writes a credential", async () => {
    const fs = seed();

    await providerAddCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        args: ["anthropic"],
        hosts: fakeHosts({ fs, env: { ANTHROPIC_API_KEY: "sk-secret" } }),
      }),
    );

    expect(fs.files.get(CONFIG_PATH)).not.toContain("sk-secret");
  });

  it("reports the credential as not required when selecting ollama", async () => {
    const fs = seed();

    const result = await providerAddCommand.execute(
      fakeContext({
        workspace,
        config: configWith(fs),
        args: ["ollama"],
        hosts: fakeHosts({ fs }),
      }),
    );

    expect(result.report.notes).toEqual([]);
    const field = result.report.fields.find((entry) => entry.label === "Credential");
    expect(field?.status).toBe("pass");
    expect(field?.value).toContain("not required");
  });

  it("rejects an unknown provider", async () => {
    const fs = seed();

    await expect(
      providerAddCommand.execute(
        fakeContext({
          workspace,
          config: configWith(fs),
          args: ["skynet"],
          hosts: fakeHosts({ fs }),
        }),
      ),
    ).rejects.toMatchObject({ code: "provider.unknown", exitCode: 5 });
  });
});
