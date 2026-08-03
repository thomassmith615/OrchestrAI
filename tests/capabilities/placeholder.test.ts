import { describe, expect, it } from "vitest";
import { placeholderCapability } from "../../src/capabilities/placeholder/index.js";
import { engineeringCapability } from "../../src/capabilities/engineering/index.js";
import { assembleRuntime } from "../../src/capabilities/index.js";
import { run } from "../../src/cli/run.js";
import { createLogger } from "../../src/core/logger.js";
import { EXIT_CODES } from "../../src/core/errors.js";
import { fakeFileSystem, fakeHosts, recordingSink } from "../support/fakes.js";
import type { Hosts } from "../../src/core/hosts.js";

describe("placeholderCapability declarations", () => {
  it("declares a real command prefix, not Engineering's backwards-compatibility concession", () => {
    expect(placeholderCapability.id).toBe("placeholder");
    expect(placeholderCapability.commandPrefix).toBe("placeholder");
  });

  it("declares its own command list, unreachable at Engineering's bare names", () => {
    const names = placeholderCapability.commands().map((command) => command.name);

    expect(names).toEqual(["ping", "status"]);
  });

  it("declares a real storage namespace", () => {
    expect(placeholderCapability.storageNamespace).toBe("placeholder");
  });

  it("declares its own config namespace and field, independent of Engineering's", () => {
    const schema = placeholderCapability.configSchema?.();

    expect(schema?.namespace).toBe("placeholder");
    expect(schema?.fields["greeting"]).toBeDefined();
    expect(schema?.defaults["greeting"]).toBe("hello");
  });

  it("requires user scope on every command it declares", () => {
    for (const command of placeholderCapability.commands()) {
      expect(command.requires).toEqual({ scope: "user" });
    }
  });
});

describe("the runtime hosting Engineering and Placeholder together", () => {
  function harness(): {
    out: ReturnType<typeof recordingSink>;
    err: ReturnType<typeof recordingSink>;
    hosts: Hosts;
    invoke: (...argv: string[]) => Promise<number>;
  } {
    // No .git anywhere in this filesystem, at all — not "outside the
    // current directory's repository", genuinely no repository exists on
    // this simulated disk. HOME is set, so user scope resolves.
    const fs = fakeFileSystem();
    const hosts = fakeHosts({ fs, env: { HOME: "/Users/demo" } });
    const out = recordingSink();
    const err = recordingSink();
    const logger = createLogger({ level: "debug", out, err });
    const { registry } = assembleRuntime([engineeringCapability, placeholderCapability]);

    return {
      out,
      err,
      hosts,
      invoke: (...argv: string[]) =>
        run({ argv, logger, cwd: "/anywhere", hosts, registry }),
    };
  }

  it("reports both capabilities activated, neither privileged over the other", async () => {
    const { out, invoke } = harness();

    expect(await invoke("capabilities", "--json")).toBe(EXIT_CODES.success);
    const data = JSON.parse(out.text()) as {
      activated: { id: string; commandPrefix: string; commands: string[] }[];
      failed: unknown[];
    };

    expect(data.failed).toEqual([]);
    const byId = Object.fromEntries(data.activated.map((entry) => [entry.id, entry]));

    expect(byId["engineering"]).toMatchObject({ commandPrefix: "" });
    expect(byId["engineering"]?.commands).toContain("status");
    expect(byId["placeholder"]).toMatchObject({ commandPrefix: "placeholder" });
    expect(byId["placeholder"]?.commands).toEqual(["placeholder ping", "placeholder status"]);
  });

  it("runs Placeholder's ping under user scope with no git repository anywhere on disk", async () => {
    const { out, invoke } = harness();

    expect(await invoke("placeholder", "ping", "--json")).toBe(EXIT_CODES.success);
    const first = JSON.parse(out.text()) as { count: number; storageRoot: string };

    expect(first.count).toBe(1);
    expect(first.storageRoot).toBe("/Users/demo/.orchestrai/placeholder");
  });

  it("persists Placeholder's state across invocations, isolated under its own namespace", async () => {
    const { out, hosts, invoke } = harness();

    await invoke("placeholder", "ping");
    out.lines.length = 0;
    await invoke("placeholder", "ping", "--json");

    const second = JSON.parse(out.text()) as { count: number };
    expect(second.count).toBe(2);

    const fs = hosts.fs as ReturnType<typeof fakeFileSystem>;
    expect(fs.files.get("/Users/demo/.orchestrai/placeholder/pings.json")).toBe(
      '{"count":2}',
    );
  });

  it("reports Placeholder's own scope and config through `placeholder status`", async () => {
    const { out, invoke } = harness();

    expect(await invoke("placeholder", "status", "--json")).toBe(EXIT_CODES.success);
    expect(JSON.parse(out.text())).toEqual({ scope: "user", greeting: "hello" });
  });

  it("leaves Engineering's own `status` command, and its repository requirement, untouched", async () => {
    // Same registry, same invocation of `run`, the bare name this time:
    // Engineering's `orch status` still requires a repository and still
    // exits 4 with none present, exactly as it does with Placeholder absent
    // entirely. Placeholder's presence changes nothing about it.
    const { err, invoke } = harness();

    expect(await invoke("status")).toBe(EXIT_CODES.precondition);
    expect(err.text()).toContain("Not inside a git repository");
  });

  it("fails Placeholder's commands with the same precondition code when no home directory resolves", async () => {
    const fs = fakeFileSystem();
    const hosts = fakeHosts({ fs, env: {} });
    const out = recordingSink();
    const err = recordingSink();
    const logger = createLogger({ level: "debug", out, err });
    const { registry } = assembleRuntime([engineeringCapability, placeholderCapability]);

    const exitCode = await run({
      argv: ["placeholder", "ping"],
      logger,
      cwd: "/anywhere",
      hosts,
      registry,
    });

    expect(exitCode).toBe(EXIT_CODES.precondition);
    expect(err.text()).toContain("home directory");
  });
});
