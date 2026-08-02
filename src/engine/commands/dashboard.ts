/**
 * `orch dashboard` serves a read-only local view.
 *
 * It binds to localhost by default and exposes no mutating route. The CLI stays
 * the only way to cause anything to happen; this surface exists to look at what
 * already did.
 */
import { createServer } from "node:http";
import { buildSnapshot, handleRequest } from "../../dashboard/index.js";
import { requireConfig, requireWorkspace } from "../command.js";
import type { AddressInfo } from "node:net";
import type { CommandContext, CommandDefinition, CommandResult } from "../command.js";

export interface DashboardData {
  readonly url: string;
  readonly port: number;
  readonly host: string;
  /** True when the server was started rather than only rendered once. */
  readonly served: boolean;
}

export const DEFAULT_PORT = 4173;

export const dashboardCommand: CommandDefinition<DashboardData> = {
  name: "dashboard",
  summary: "Serve a read-only local dashboard",
  options: [
    { flags: "--port <port>", description: `Port to listen on (default ${String(DEFAULT_PORT)})` },
    { flags: "--host <host>", description: "Interface to bind (default 127.0.0.1)" },
    { flags: "--once", description: "Print the HTML and exit without serving" },
  ],
  requires: { config: true },

  async execute(context: CommandContext): Promise<CommandResult<DashboardData>> {
    const workspace = requireWorkspace(context);
    const config = requireConfig(context);

    const snapshot = (): ReturnType<typeof buildSnapshot> =>
      buildSnapshot(workspace, context.hosts, config.values.roadmapPath);

    const portOption = context.options["port"];
    const port =
      typeof portOption === "string"
        ? Number.parseInt(portOption, 10)
        : DEFAULT_PORT;
    const hostOption = context.options["host"];
    const host = typeof hostOption === "string" ? hostOption : "127.0.0.1";

    if (context.options["once"] === true) {
      const response = handleRequest("/", snapshot);

      return {
        data: { url: "", port, host, served: false },
        report: { fields: [], notes: [response.body] },
      };
    }

    const server = createServer((request, response) => {
      const result = handleRequest(request.url ?? "/", snapshot);
      response.writeHead(result.status, { "content-type": result.contentType });
      response.end(result.body);
    });

    const bound = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number.isNaN(port) ? DEFAULT_PORT : port, host, () => {
        resolve((server.address() as AddressInfo).port);
      });
    });

    const url = `http://${host}:${String(bound)}/`;
    context.logger.print(`Serving ${url}  (ctrl-c to stop)`);

    // Resolves when the process is interrupted; the command owns the terminal
    // until then, the way `npm start` does.
    await new Promise<void>((resolve) => {
      const stop = (): void => {
        server.close(() => {
          resolve();
        });
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });

    return {
      data: { url, port: bound, host, served: true },
      report: {
        fields: [
          { label: "Served", value: url },
          { label: "Snapshot", value: `${url}api/snapshot` },
        ],
      },
    };
  },
};
