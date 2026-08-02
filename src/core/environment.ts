/**
 * Snapshot of the environment Orchestrai is running in.
 *
 * Later milestones extend this with repository, git, and toolchain detection.
 * Every source is injectable so that tests never depend on the machine they
 * run on.
 */
import { packageName, packageVersion } from "./manifest.js";

export interface EnvironmentHost {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  cwd(): string;
}

export interface EnvironmentSnapshot {
  readonly name: string;
  readonly version: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly workingDirectory: string;
}

const nodeHost: EnvironmentHost = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  cwd: () => process.cwd(),
};

/** Any subset of the host may be overridden; the rest comes from the process. */
export function describeEnvironment(
  overrides: Partial<EnvironmentHost> = {},
): EnvironmentSnapshot {
  const host: EnvironmentHost = { ...nodeHost, ...overrides };

  return {
    name: packageName(),
    version: packageVersion(),
    nodeVersion: host.nodeVersion,
    platform: host.platform,
    arch: host.arch,
    workingDirectory: host.cwd(),
  };
}
