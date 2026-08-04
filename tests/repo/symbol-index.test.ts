import { describe, expect, it } from "vitest";
import {
  buildSymbolIndex,
  definitionsOf,
  referencesTo,
  scanRepository,
} from "../../src/repo/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { SymbolIndex } from "../../src/repo/index.js";

function index(files: Record<string, string>): SymbolIndex {
  const fs = fakeFileSystem(files);

  return buildSymbolIndex({
    root: "/repo",
    fs,
    files: scanRepository({ root: "/repo", fs }).files,
  });
}

describe("buildSymbolIndex", () => {
  it("separates where a symbol is declared from where it is used", () => {
    const built = index({
      "/repo/src/vehicle/VehicleModel.ts": "export class VehicleModel {}",
      "/repo/src/ui/WeightPanel.ts":
        "import { VehicleModel } from '../vehicle/VehicleModel.js';",
      "/repo/README.md": "# a project",
    });

    expect(definitionsOf(built, "VehicleModel")).toEqual([
      "src/vehicle/VehicleModel.ts",
    ]);
    expect(referencesTo(built, "VehicleModel")).toEqual([
      "src/ui/WeightPanel.ts",
      "src/vehicle/VehicleModel.ts",
    ]);
  });

  it("finds references in files whose paths say nothing about the symbol", () => {
    // The whole point. Path based ranking cannot see this file; the index can.
    const built = index({
      "/repo/src/vehicle/VehicleModel.ts": "export class VehicleModel {}",
      "/repo/src/snapping/SnapEngine.ts": "const target: VehicleModel = load();",
    });

    expect(referencesTo(built, "VehicleModel")).toContain(
      "src/snapping/SnapEngine.ts",
    );
  });

  it("returns nothing for a symbol the repository never names", () => {
    const built = index({ "/repo/src/index.ts": "export const value = 1;" });

    expect(definitionsOf(built, "Vehicle")).toEqual([]);
    expect(referencesTo(built, "Vehicle")).toEqual([]);
  });

  it("is case sensitive, because identifiers are", () => {
    const built = index({ "/repo/src/a.ts": "export class Vehicle {}" });

    expect(definitionsOf(built, "vehicle")).toEqual([]);
    expect(definitionsOf(built, "Vehicle")).toEqual(["src/a.ts"]);
  });

  it("skips binary and oversized files without reading them", () => {
    const built = index({
      "/repo/src/a.ts": "export class Vehicle {}",
      "/repo/logo.png": "Vehicle",
    });

    expect(built.files).toBe(1);
    expect(referencesTo(built, "Vehicle")).toEqual(["src/a.ts"]);
  });
});
