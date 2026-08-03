import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/core/logger.js";
import { fakeHosts } from "../support/fakes.js";
import type { Capability } from "../../src/runtime/capability.js";
import type { JobContext, JobDefinition } from "../../src/runtime/jobs.js";

function jobCapability(id: string, job: JobDefinition): Capability {
  return {
    id,
    summary: "A capability that declares a job",
    commandPrefix: id,
    commands: () => [],
    jobs: () => [job],
  };
}

describe("JobDefinition", () => {
  it("runs with the context it declared, independent of any other capability's job", async () => {
    // The proof: two unrelated capabilities each declare a job — even
    // reusing the same bare name — and each runs from its own context with
    // no shared structure between them to collide in.
    const context: JobContext = { logger: createLogger({ level: "silent" }), hosts: fakeHosts() };
    const homeRuns: string[] = [];
    const camperCadRuns: string[] = [];

    const home = jobCapability("home", {
      name: "sync",
      description: "Sync Home's connectors",
      run: (ctx) => {
        homeRuns.push(ctx.hosts.env["MARK"] ?? "unset");
        return Promise.resolve();
      },
    });
    const camperCad = jobCapability("campercad", {
      name: "sync",
      description: "Sync CamperCAD's project index",
      run: (ctx) => {
        camperCadRuns.push(ctx.hosts.env["MARK"] ?? "unset");
        return Promise.resolve();
      },
    });

    await home.jobs?.()[0]?.run(context);
    await camperCad.jobs?.()[0]?.run(context);

    expect(homeRuns).toEqual(["unset"]);
    expect(camperCadRuns).toEqual(["unset"]);
  });

  it("propagates a rejection from run to the caller", async () => {
    const context: JobContext = { logger: createLogger({ level: "silent" }), hosts: fakeHosts() };
    const failing: JobDefinition = {
      name: "broken",
      description: "Always fails",
      run: () => Promise.reject(new Error("boom")),
    };

    await expect(failing.run(context)).rejects.toThrow("boom");
  });

  it("is omitted entirely by a capability with nothing to schedule", () => {
    const noJobs: Capability = {
      id: "none",
      summary: "No jobs",
      commandPrefix: "none",
      commands: () => [],
    };

    expect("jobs" in noJobs).toBe(false);
  });
});
