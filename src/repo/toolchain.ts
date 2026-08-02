/**
 * Toolchain fingerprint.
 *
 * Reads manifests to learn how a repository builds, tests, lints, and type
 * checks itself. This is what makes the platform polyglot without the
 * implementation being polyglot: Milestone 5 runs whatever is detected here,
 * and never assumes npm.
 *
 * Detection is conservative. An undetected command is null, which is honest,
 * rather than a guess that fails at runtime.
 */
import { join } from "node:path";
import type { FileSystemHost } from "../core/hosts.js";

export type Ecosystem = "node" | "java" | "python" | "go" | "rust" | "unknown";

export interface ToolCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface Toolchain {
  readonly ecosystem: Ecosystem;
  readonly packageManager: string | null;
  readonly build: ToolCommand | null;
  readonly test: ToolCommand | null;
  readonly lint: ToolCommand | null;
  readonly typecheck: ToolCommand | null;
  readonly ci: string | null;
  /** Manifest files that were found, relative to the repository root. */
  readonly manifests: readonly string[];
}

export function formatCommand(command: ToolCommand | null): string | null {
  return command === null
    ? null
    : [command.command, ...command.args].join(" ");
}

function readJson(
  fs: FileSystemHost,
  path: string,
): Record<string, unknown> | null {
  if (!fs.exists(path)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFile(path));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function detectCi(fs: FileSystemHost, root: string): string | null {
  const candidates: readonly [string, string][] = [
    [".github/workflows", "github-actions"],
    [".gitlab-ci.yml", "gitlab-ci"],
    ["Jenkinsfile", "jenkins"],
    [".circleci/config.yml", "circleci"],
    ["azure-pipelines.yml", "azure-pipelines"],
  ];

  for (const [path, name] of candidates) {
    if (fs.exists(join(root, path))) {
      return name;
    }
  }

  return null;
}

function nodePackageManager(fs: FileSystemHost, root: string): string {
  if (fs.exists(join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.exists(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (fs.exists(join(root, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

/** `npm test` is special cased; every other script needs `run`. */
function nodeScript(manager: string, script: string): ToolCommand {
  return script === "test"
    ? { command: manager, args: ["test"] }
    : { command: manager, args: ["run", script] };
}

function firstScript(
  scripts: Readonly<Record<string, unknown>>,
  manager: string,
  candidates: readonly string[],
): ToolCommand | null {
  for (const name of candidates) {
    if (typeof scripts[name] === "string") {
      return nodeScript(manager, name);
    }
  }
  return null;
}

function detectNode(fs: FileSystemHost, root: string): Toolchain | null {
  const manifest = readJson(fs, join(root, "package.json"));
  if (manifest === null) {
    return null;
  }

  const rawScripts = manifest["scripts"];
  const scripts: Record<string, unknown> =
    typeof rawScripts === "object" && rawScripts !== null
      ? (rawScripts as Record<string, unknown>)
      : {};

  const manager = nodePackageManager(fs, root);

  return {
    ecosystem: "node",
    packageManager: manager,
    build: firstScript(scripts, manager, ["build", "compile"]),
    test: firstScript(scripts, manager, ["test"]),
    lint: firstScript(scripts, manager, ["lint"]),
    typecheck: firstScript(scripts, manager, ["typecheck", "type-check", "tsc"]),
    ci: detectCi(fs, root),
    manifests: ["package.json"],
  };
}

function detectJava(fs: FileSystemHost, root: string): Toolchain | null {
  const maven = fs.exists(join(root, "pom.xml"));
  const gradle =
    fs.exists(join(root, "build.gradle")) ||
    fs.exists(join(root, "build.gradle.kts"));

  if (!maven && !gradle) {
    return null;
  }

  if (maven) {
    return {
      ecosystem: "java",
      packageManager: "maven",
      build: { command: "mvn", args: ["-B", "compile"] },
      test: { command: "mvn", args: ["-B", "test"] },
      lint: null,
      typecheck: null,
      ci: detectCi(fs, root),
      manifests: ["pom.xml"],
    };
  }

  const wrapper = fs.exists(join(root, "gradlew")) ? "./gradlew" : "gradle";

  return {
    ecosystem: "java",
    packageManager: "gradle",
    build: { command: wrapper, args: ["build", "-x", "test"] },
    test: { command: wrapper, args: ["test"] },
    lint: null,
    typecheck: null,
    ci: detectCi(fs, root),
    manifests: [
      fs.exists(join(root, "build.gradle")) ? "build.gradle" : "build.gradle.kts",
    ],
  };
}

function detectPython(fs: FileSystemHost, root: string): Toolchain | null {
  const pyproject = fs.exists(join(root, "pyproject.toml"));
  const requirements = fs.exists(join(root, "requirements.txt"));

  if (!pyproject && !requirements) {
    return null;
  }

  const contents = pyproject ? fs.readFile(join(root, "pyproject.toml")) : "";
  const manager = contents.includes("[tool.poetry]")
    ? "poetry"
    : contents.includes("[tool.uv]")
      ? "uv"
      : "pip";

  return {
    ecosystem: "python",
    packageManager: manager,
    build: null,
    test: { command: "pytest", args: [] },
    lint: contents.includes("[tool.ruff]")
      ? { command: "ruff", args: ["check", "."] }
      : null,
    typecheck: contents.includes("[tool.mypy]")
      ? { command: "mypy", args: ["."] }
      : null,
    ci: detectCi(fs, root),
    manifests: [
      ...(pyproject ? ["pyproject.toml"] : []),
      ...(requirements ? ["requirements.txt"] : []),
    ],
  };
}

function detectGo(fs: FileSystemHost, root: string): Toolchain | null {
  if (!fs.exists(join(root, "go.mod"))) {
    return null;
  }

  return {
    ecosystem: "go",
    packageManager: "go modules",
    build: { command: "go", args: ["build", "./..."] },
    test: { command: "go", args: ["test", "./..."] },
    lint: { command: "go", args: ["vet", "./..."] },
    typecheck: null,
    ci: detectCi(fs, root),
    manifests: ["go.mod"],
  };
}

function detectRust(fs: FileSystemHost, root: string): Toolchain | null {
  if (!fs.exists(join(root, "Cargo.toml"))) {
    return null;
  }

  return {
    ecosystem: "rust",
    packageManager: "cargo",
    build: { command: "cargo", args: ["build"] },
    test: { command: "cargo", args: ["test"] },
    lint: { command: "cargo", args: ["clippy"] },
    typecheck: { command: "cargo", args: ["check"] },
    ci: detectCi(fs, root),
    manifests: ["Cargo.toml"],
  };
}

const DETECTORS = [
  detectNode,
  detectJava,
  detectPython,
  detectGo,
  detectRust,
] as const;

/**
 * Returns the first ecosystem whose manifest is present. Polyglot repositories
 * report the first match; Milestone 8 revisits this if it becomes limiting.
 */
export function detectToolchain(fs: FileSystemHost, root: string): Toolchain {
  for (const detect of DETECTORS) {
    const found = detect(fs, root);
    if (found !== null) {
      return found;
    }
  }

  return {
    ecosystem: "unknown",
    packageManager: null,
    build: null,
    test: null,
    lint: null,
    typecheck: null,
    ci: detectCi(fs, root),
    manifests: [],
  };
}
