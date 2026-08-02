import { describe, expect, it } from "vitest";
import { buildSnapshot, handleRequest, renderDashboard } from "../../src/dashboard/index.js";
import { fakeFileSystem, fakeHosts, fakeProcess } from "../support/fakes.js";
import type { DashboardSnapshot } from "../../src/dashboard/index.js";

const workspace = {
  root: "/repo",
  stateDir: "/repo/.orchestrai",
  configPath: "/repo/orchestrai.config.json",
  initialized: true,
};

function snapshot(): DashboardSnapshot {
  const fs = fakeFileSystem({
    "/repo/.git/HEAD": "",
    "/repo/.orchestrai/.gitignore": "cache/",
    "/repo/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
    "/repo/src/a.ts": "export const a = 1;\n",
    "/repo/docs/ROADMAP.md": "- [x] **M1. Done**\n\n- [ ] **M2. Next**\n",
  });

  return buildSnapshot(
    workspace,
    fakeHosts({
      fs,
      proc: fakeProcess({}, {
        "git status": { stdout: "# branch.head main" },
        "git log": { stdout: "abc\u001fabc\u001fInitial" },
      }),
    }),
    "docs/ROADMAP.md",
  );
}

describe("buildSnapshot", () => {
  it("assembles repository, roadmap, and spend state", () => {
    const result = snapshot();

    expect(result.branch).toBe("main");
    expect(result.dirty).toBe(false);
    expect(result.ecosystem).toBe("node");
    expect(result.files).toBeGreaterThan(0);
    expect(result.roadmap).toMatchObject({
      completed: 1,
      total: 2,
      current: "M2: Next",
    });
    expect(result.usage.calls).toBe(0);
  });
});

describe("renderDashboard", () => {
  it("produces a self contained document with no external requests", () => {
    const html = renderDashboard(snapshot());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(html).toContain("M2: Next");
  });

  it("escapes values rather than interpolating them raw", () => {
    const html = renderDashboard({
      ...snapshot(),
      repository: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("exposes no mutating affordance", () => {
    const html = renderDashboard(snapshot());

    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<button/i);
  });
});

describe("handleRequest", () => {
  it("serves the page at the root", () => {
    const response = handleRequest("/", snapshot);

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/html");
  });

  it("serves the snapshot as JSON", () => {
    const response = handleRequest("/api/snapshot", snapshot);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ branch: "main" });
  });

  it("returns 404 for anything else", () => {
    expect(handleRequest("/admin", snapshot).status).toBe(404);
  });
});
