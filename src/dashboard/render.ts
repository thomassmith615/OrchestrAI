/**
 * Dashboard rendering.
 *
 * One self contained HTML document with no build step, no framework, and no
 * external requests. The dashboard visualizes and monitors; every action stays
 * in the CLI, so there is nothing here to submit.
 */
import type { DashboardSnapshot } from "./snapshot.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusClass(status: string): string {
  if (status === "pass" || status === "ok" || status === "applied") {
    return "ok";
  }
  if (status === "fail" || status === "failed" || status === "rejected") {
    return "bad";
  }
  return "muted";
}

function rows(
  entries: readonly { label: string; value: string; status?: string }[],
): string {
  if (entries.length === 0) {
    return `<p class="muted">Nothing yet.</p>`;
  }

  return `<table>${entries
    .map(
      (entry) =>
        `<tr><th>${escapeHtml(entry.label)}</th><td class="${
          entry.status === undefined ? "" : statusClass(entry.status)
        }">${escapeHtml(entry.value)}</td></tr>`,
    )
    .join("")}</table>`;
}

export function renderDashboard(snapshot: DashboardSnapshot): string {
  const percent =
    snapshot.roadmap.total === 0
      ? 0
      : Math.round((snapshot.roadmap.completed / snapshot.roadmap.total) * 100);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Orchestrai</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 2rem; max-width: 60rem; }
h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
h2 { font-size: .85rem; text-transform: uppercase; letter-spacing: .08em; opacity: .6; margin: 2rem 0 .5rem; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-weight: normal; opacity: .6; padding: .2rem 1rem .2rem 0; white-space: nowrap; vertical-align: top; width: 12rem; }
td { padding: .2rem 0; }
.ok { color: #2e7d32; }
.bad { color: #c62828; }
.muted { opacity: .55; }
.bar { height: .4rem; background: currentColor; opacity: .15; border-radius: 2px; margin: .4rem 0 0; }
.bar > span { display: block; height: 100%; background: currentColor; opacity: .8; border-radius: 2px; }
footer { margin-top: 2.5rem; opacity: .5; font-size: .8rem; }
</style>
</head>
<body>
<h1>${escapeHtml(snapshot.repository)}</h1>
<div class="muted">${escapeHtml(snapshot.branch ?? "detached")}${
    snapshot.dirty ? " (uncommitted changes)" : " (clean)"
  } &middot; ${String(snapshot.files)} files &middot; ${escapeHtml(
    snapshot.ecosystem,
  )}</div>

<h2>Roadmap</h2>
${rows([
  {
    label: "Progress",
    value: `${String(snapshot.roadmap.completed)} of ${String(snapshot.roadmap.total)} complete (${String(percent)}%)`,
  },
  { label: "Current", value: snapshot.roadmap.current ?? "none pending" },
])}
<div class="bar"><span style="width:${String(percent)}%"></span></div>

<h2>Gates</h2>
${rows(
  snapshot.gates.map((gate) => ({
    label: gate.name,
    value: gate.status,
    status: gate.status,
  })),
)}

<h2>Runs</h2>
${rows(
  snapshot.runs.map((run) => ({
    label: run.id,
    value: `${run.milestone ?? "no milestone"}${
      run.failedAt === null ? "" : ` (stopped at ${run.failedAt})`
    }`,
    status: run.status,
  })),
)}

<h2>Proposals</h2>
${rows(
  snapshot.proposals.map((proposal) => ({
    label: proposal.id,
    value: `${proposal.status} - ${proposal.task} (${String(proposal.files)} files)`,
    status: proposal.status,
  })),
)}

<h2>Memory</h2>
${rows(
  snapshot.memory.map((record) => ({
    label: record.kind,
    value: record.title,
  })),
)}

<h2>Spend</h2>
${rows([
  { label: "Calls", value: String(snapshot.usage.calls) },
  {
    label: "Tokens",
    value: `${String(snapshot.usage.inputTokens)} in, ${String(snapshot.usage.outputTokens)} out`,
  },
  {
    label: "Estimated",
    value: `$${snapshot.usage.costUsd.toFixed(4)}${
      snapshot.usage.unpriced === 0
        ? ""
        : ` (${String(snapshot.usage.unpriced)} calls unpriced)`
    }`,
  },
])}

<footer>Read only. Everything here is done from the <code>orch</code> CLI.
Generated ${escapeHtml(new Date(snapshot.generatedAt).toISOString())}.</footer>
</body>
</html>`;
}

export interface DashboardResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/** Pure request handling, so the surface is testable without binding a port. */
export function handleRequest(
  path: string,
  snapshot: () => DashboardSnapshot,
): DashboardResponse {
  if (path === "/" || path === "/index.html") {
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: renderDashboard(snapshot()),
    };
  }

  if (path === "/api/snapshot") {
    return {
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(snapshot(), null, 2),
    };
  }

  return {
    status: 404,
    contentType: "text/plain; charset=utf-8",
    body: "not found",
  };
}
