/**
 * Access to the package manifest.
 *
 * The version is read at runtime rather than inlined at build time so that a
 * published binary always reports the version it was installed as.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

// Resolves to the package root from both `src/core` and `dist/core`.
const manifest = require("../../package.json") as PackageManifest;

export function packageName(): string {
  return manifest.name;
}

export function packageVersion(): string {
  return manifest.version;
}

export function packageDescription(): string {
  return manifest.description;
}
