import { describe, expect, it } from "vitest";
import {
  rankingTerms,
  resolveWorkingSet,
  symbolTerms,
} from "../../src/context/index.js";
import { buildSymbolIndex, scanRepository } from "../../src/repo/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { SymbolIndex } from "../../src/repo/index.js";
import type { WorkingSet } from "../../src/context/index.js";

function index(files: Record<string, string>): SymbolIndex {
  const fs = fakeFileSystem(files);

  return buildSymbolIndex({
    root: "/repo",
    fs,
    files: scanRepository({ root: "/repo", fs }).files,
  });
}

function resolve(
  files: Record<string, string>,
  options: { task?: string; focus?: string[] },
): WorkingSet {
  return resolveWorkingSet({ ...options, index: index(files) });
}

describe("symbolTerms", () => {
  it("accepts identifier shaped words from a task", () => {
    expect(symbolTerms({ task: "rename Vehicle to VehicleModel" })).toEqual([
      "Vehicle",
      "VehicleModel",
    ]);
    expect(symbolTerms({ task: "raise MAX_SIZE" })).toEqual(["MAX_SIZE"]);
  });

  it("rejects plain English, which is indistinguishable from a lower case name", () => {
    expect(symbolTerms({ task: "add a health check endpoint" })).toEqual([]);
  });

  it("trusts an explicit focus term even when it is lower case", () => {
    expect(symbolTerms({ task: "tidy up", focus: ["shell"] })).toEqual(["shell"]);
  });
});

describe("rankingTerms", () => {
  it("is broader than the symbol rule, because a path hint costs nothing", () => {
    expect(rankingTerms({ task: "add a health check endpoint" })).toEqual([
      "health",
      "check",
      "endpoint",
    ]);
  });

  it("prefers explicit focus terms when they are given", () => {
    expect(rankingTerms({ task: "anything at all", focus: ["vehicle"] })).toEqual([
      "vehicle",
    ]);
  });
});

describe("resolveWorkingSet", () => {
  // The failure this module exists to prevent: a rename whose reference sites
  // live in files whose paths say nothing about the symbol. Ranking by path
  // scored the declaration highest and was blind to every one of these.
  const CAMPER = {
    "/repo/src/vehicle/VehicleModel.ts": "export class VehicleModel {}",
    "/repo/src/ui/WeightPanel.ts": "const v: VehicleModel = get();",
    "/repo/src/snapping/SnapEngine.ts": "function snap(v: VehicleModel) {}",
    "/repo/src/render/Walkthrough.ts": "// unrelated to the task",
    "/repo/README.md": "# CamperCAD",
  };

  it("requires every file referencing a symbol the task names", () => {
    const working = resolve(CAMPER, { task: "rename VehicleModel to Chassis" });

    expect(working.symbols).toEqual(["VehicleModel"]);
    expect(working.required.map((entry) => entry.path)).toEqual([
      "src/vehicle/VehicleModel.ts",
      "src/snapping/SnapEngine.ts",
      "src/ui/WeightPanel.ts",
    ]);
  });

  it("explains why each file is required, declaration site first", () => {
    const working = resolve(CAMPER, { task: "rename VehicleModel to Chassis" });

    expect(working.required[0]).toEqual({
      path: "src/vehicle/VehicleModel.ts",
      reason: "declares VehicleModel",
    });
    expect(working.required[1]?.reason).toBe("references VehicleModel");
  });

  it("ignores a term the repository does not declare", () => {
    // `Chassis` is the new name in a rename, so it does not exist yet, and
    // `Vehicle` is a substring of a real symbol but not a symbol itself.
    const working = resolve(CAMPER, {
      task: "rename Vehicle to Chassis",
    });

    expect(working.symbols).toEqual([]);
    expect(working.required).toEqual([]);
  });

  it("requires nothing for a task that names no symbol at all", () => {
    const working = resolve(CAMPER, { task: "add a health check endpoint" });

    expect(working.required).toEqual([]);
  });

  it("merges the reasons when two symbols pull in the same file", () => {
    const working = resolve(
      {
        "/repo/src/a.ts": "export class Alpha {}\nexport class Beta {}",
      },
      { task: "merge Alpha and Beta" },
    );

    expect(working.symbols).toEqual(["Alpha", "Beta"]);
    expect(working.required).toEqual([
      { path: "src/a.ts", reason: "declares Alpha, declares Beta" },
    ]);
  });
});
