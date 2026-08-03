/**
 * The job contract.
 *
 * A job is a declared unit of work a capability wants to be able to run
 * later. This is the contract only: nothing in this milestone executes a
 * job, on a schedule or otherwise, outside a caller invoking `run` directly.
 * There is no scheduler here, and none is planned for this runtime —
 * `launchd` already exists for a single always-on Mac, and a scheduler
 * earns its place only when jobs exist whose timing genuinely interacts.
 *
 * Unlike commands or config fields, job names are not merged into one
 * shared, collision-checked structure by this milestone, because nothing
 * yet addresses a job by name across capabilities — there is no registry to
 * collide in until something (a future `orch jobs run <name>`, most likely)
 * actually needs one. See ADR 0020.
 */
import type { Hosts } from "../core/hosts.js";
import type { Logger } from "../core/logger.js";

/**
 * What a job's `run` receives: a deliberately narrow, present-day subset of
 * what will eventually consolidate into one runtime service container, once
 * enough injection points like this one exist to justify it. Not a preview
 * of that container — just the two things a job actually needs today.
 */
export interface JobContext {
  readonly logger: Logger;
  readonly hosts: Hosts;
}

export interface JobDefinition {
  /** Unique within the capability that declares it; not yet namespaced
   *  globally, since nothing yet addresses jobs across capabilities. */
  readonly name: string;
  readonly description: string;
  run(context: JobContext): Promise<void>;
}
