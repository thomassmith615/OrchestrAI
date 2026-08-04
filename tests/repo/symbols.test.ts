import { describe, expect, it } from "vitest";
import { extractSymbols } from "../../src/repo/index.js";

describe("extractSymbols", () => {
  it("finds declarations introduced by a keyword", () => {
    const symbols = extractSymbols(
      "export class VehicleModel {}\nexport interface VehicleSpec {}\n",
    );

    expect(symbols.defines).toContain("VehicleModel");
    expect(symbols.defines).toContain("VehicleSpec");
  });

  it("finds declarations across languages, not only TypeScript", () => {
    expect(extractSymbols("def build_shell(width):").defines).toContain(
      "build_shell",
    );
    expect(extractSymbols("func NewVehicle() *Vehicle {").defines).toContain(
      "NewVehicle",
    );
    expect(extractSymbols("pub struct Vehicle { }").defines).toContain(
      "Vehicle",
    );
    expect(extractSymbols("public class Vehicle {").defines).toContain(
      "Vehicle",
    );
  });

  it("counts every identifier as a mention, declarations included", () => {
    const symbols = extractSymbols(
      "import { VehicleModel } from './vehicle';\nconst shell = new VehicleModel();",
    );

    expect(symbols.mentions).toContain("VehicleModel");
    expect(symbols.mentions).toContain("shell");
    expect(symbols.defines).toContain("shell");
  });

  it("does not treat keywords as symbols", () => {
    const symbols = extractSymbols("export class Foo { public static void bar; }");

    expect(symbols.mentions).not.toContain("class");
    expect(symbols.mentions).not.toContain("export");
    // `public static` is a keyword run, so nothing is claimed to be declared by
    // it. Only the real declaration survives.
    expect(symbols.defines).toEqual(["Foo"]);
  });

  it("counts identifiers named only in comments", () => {
    // Deliberate: a file whose comments discuss a symbol is a file worth
    // showing to someone changing that symbol. Over-inclusion is the safe
    // direction, and stripping comments correctly means writing a lexer.
    const symbols = extractSymbols("// superseded by VehicleModel\nconst x = 1;");

    expect(symbols.mentions).toContain("VehicleModel");
  });

  it("ignores identifiers too short to carry signal", () => {
    const symbols = extractSymbols("const a = b + cd;");

    expect(symbols.mentions).not.toContain("a");
    expect(symbols.mentions).not.toContain("cd");
  });
});
