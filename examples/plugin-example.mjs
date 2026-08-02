/**
 * A minimal Orchestrai plugin.
 *
 * Load it by adding the path to the `plugins` setting:
 *
 *   orch config --set plugins=./examples/plugin-example.mjs
 *   orch plugins
 *   orch hello
 *
 * It declares `read-repo`, so `setup` receives a read-only filesystem and no
 * network or process access at all. Permissions are a declaration rather than
 * a sandbox: see docs/CLI.md.
 */
export default {
  name: "hello",
  version: "1.0.0",
  description: "Example plugin that adds one command",
  permissions: ["read-repo"],

  commands: [
    {
      name: "hello",
      summary: "Say hello from a plugin",
      args: [{ name: "who", description: "Who to greet", required: false }],
      execute(context) {
        const who = context.args[0] ?? "world";

        return Promise.resolve({
          data: { greeting: `hello ${who}` },
          report: {
            fields: [
              { label: "Greeting", value: `hello ${who}` },
              { label: "Plugin", value: "hello@1.0.0" },
            ],
          },
        });
      },
    },
  ],

  setup(context) {
    context.logger.debug(`hello plugin ready for ${context.root}`);
  },
};
