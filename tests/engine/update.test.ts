import { describe, expect, it } from "vitest";
import { isNewer, updateCommand } from "../../src/engine/commands/update.js";
import { packageVersion } from "../../src/core/manifest.js";
import { fakeContext, fakeHosts, fakeHttp } from "../support/fakes.js";

describe("isNewer", () => {
  it("compares dotted versions numerically", () => {
    expect(isNewer("1.2.0", "1.1.9")).toBe(true);
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.9.0", "1.0.0")).toBe(false);
  });

  it("ignores prerelease suffixes", () => {
    expect(isNewer("2.0.0-beta.1", "1.9.9")).toBe(true);
  });
});

describe("updateCommand", () => {
  it("reports the published version", async () => {
    const http = fakeHttp({ body: JSON.stringify({ version: "99.0.0" }) });
    const result = await updateCommand.execute(
      fakeContext({ hosts: fakeHosts({ http }) }),
    );

    expect(result.data).toMatchObject({
      current: packageVersion(),
      latest: "99.0.0",
      outdated: true,
      checked: true,
    });
    expect(result.report.notes?.join(" ")).toContain("npm install");
  });

  it("does not fail when the registry is unreachable", async () => {
    const result = await updateCommand.execute(
      fakeContext({ hosts: fakeHosts({ http: fakeHttp({ throws: true }) }) }),
    );

    expect(result.data.checked).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it("skips the check entirely when offline", async () => {
    const http = fakeHttp();
    await updateCommand.execute(
      fakeContext({ options: { offline: true }, hosts: fakeHosts({ http }) }),
    );

    expect(http.requests).toHaveLength(0);
  });

  it("never installs anything", () => {
    expect(updateCommand.summary).toContain("Report");
  });
});
