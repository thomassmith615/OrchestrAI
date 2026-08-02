import { describe, expect, it } from "vitest";
import { detectToolchain, formatCommand } from "../../src/repo/index.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { Toolchain } from "../../src/repo/index.js";

function detect(files: Record<string, string>): Toolchain {
  return detectToolchain(fakeFileSystem(files), "/repo");
}

describe("detectToolchain", () => {
  it("reads node scripts and maps them to commands", () => {
    const toolchain = detect({
      "/repo/package.json": JSON.stringify({
        scripts: { build: "tsc", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" },
      }),
    });

    expect(toolchain.ecosystem).toBe("node");
    expect(toolchain.packageManager).toBe("npm");
    expect(formatCommand(toolchain.build)).toBe("npm run build");
    expect(formatCommand(toolchain.test)).toBe("npm test");
    expect(formatCommand(toolchain.typecheck)).toBe("npm run typecheck");
  });

  it("detects the package manager from the lockfile", () => {
    const manifest = JSON.stringify({ scripts: { test: "vitest" } });

    expect(
      detect({ "/repo/package.json": manifest, "/repo/pnpm-lock.yaml": "" })
        .packageManager,
    ).toBe("pnpm");
    expect(
      detect({ "/repo/package.json": manifest, "/repo/yarn.lock": "" })
        .packageManager,
    ).toBe("yarn");
  });

  it("returns null for scripts that do not exist", () => {
    const toolchain = detect({
      "/repo/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
    });

    expect(toolchain.build).toBeNull();
    expect(toolchain.lint).toBeNull();
    expect(formatCommand(toolchain.lint)).toBeNull();
  });

  it("detects maven and gradle", () => {
    expect(formatCommand(detect({ "/repo/pom.xml": "<project/>" }).test)).toBe(
      "mvn -B test",
    );

    const gradle = detect({ "/repo/build.gradle": "", "/repo/gradlew": "" });
    expect(formatCommand(gradle.test)).toBe("./gradlew test");
    expect(gradle.packageManager).toBe("gradle");
  });

  it("detects python tooling from pyproject sections", () => {
    const toolchain = detect({
      "/repo/pyproject.toml": "[tool.poetry]\n[tool.ruff]\n[tool.mypy]\n",
    });

    expect(toolchain.packageManager).toBe("poetry");
    expect(formatCommand(toolchain.lint)).toBe("ruff check .");
    expect(formatCommand(toolchain.typecheck)).toBe("mypy .");
  });

  it("detects go and rust", () => {
    expect(formatCommand(detect({ "/repo/go.mod": "module x" }).test)).toBe(
      "go test ./...",
    );
    expect(formatCommand(detect({ "/repo/Cargo.toml": "[package]" }).lint)).toBe(
      "cargo clippy",
    );
  });

  it("detects CI independently of ecosystem", () => {
    expect(detect({ "/repo/.github/workflows/ci.yml": "on: push" }).ci).toBe(
      "github-actions",
    );
    expect(detect({ "/repo/.gitlab-ci.yml": "" }).ci).toBe("gitlab-ci");
  });

  it("reports unknown rather than guessing", () => {
    const toolchain = detect({ "/repo/README.md": "# hi" });

    expect(toolchain.ecosystem).toBe("unknown");
    expect(toolchain.test).toBeNull();
    expect(toolchain.manifests).toEqual([]);
  });

  it("survives a malformed manifest", () => {
    expect(detect({ "/repo/package.json": "{ broken" }).ecosystem).toBe(
      "unknown",
    );
  });
});
