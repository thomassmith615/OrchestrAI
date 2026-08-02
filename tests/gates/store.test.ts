import { describe, expect, it } from "vitest";
import { readGateRun, recordGateRun, summarize } from "../../src/gates/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { GateRun } from "../../src/gates/index.js";

function sampleRun(): GateRun {
  return summarize(
    [
      {
        name: "test",
        status: "pass",
        command: "npm test",
        exitCode: 0,
        durationMs: 120,
        timedOut: false,
        output: "",
      },
    ],
    1000,
    120,
  );
}

describe("gate store", () => {
  it("round trips a run", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "cache/" });

    expect(recordGateRun(fs, "/repo/.orchestrai", sampleRun())).toBe(true);
    expect(readGateRun(fs, "/repo/.orchestrai")).toEqual(sampleRun());
  });

  it("does nothing when the state directory is absent", () => {
    const fs = fakeFileSystem();

    expect(recordGateRun(fs, "/repo/.orchestrai", sampleRun())).toBe(false);
    expect(readGateRun(fs, "/repo/.orchestrai")).toBeNull();
  });

  it("ignores an unreadable or stale document", () => {
    const broken = fakeFileSystem({ "/repo/.orchestrai/gates.json": "{ nope" });
    expect(readGateRun(broken, "/repo/.orchestrai")).toBeNull();

    const stale = fakeFileSystem({
      "/repo/.orchestrai/gates.json": JSON.stringify({ schemaVersion: 0, run: {} }),
    });
    expect(readGateRun(stale, "/repo/.orchestrai")).toBeNull();
  });

  it("writes human readable json", () => {
    const fs = fakeFileSystem({ "/repo/.orchestrai/.gitignore": "" });
    recordGateRun(fs, "/repo/.orchestrai", sampleRun());

    expect(fs.files.get("/repo/.orchestrai/gates.json")).toContain("\n  ");
  });
});
