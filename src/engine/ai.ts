/**
 * Provider invocation with packed context.
 *
 * One place where scanning, ranking, prompt rendering, and the provider call
 * come together, so that every command that talks to a model does it the same
 * way and records the same metadata.
 */
import { packContext, recentlyChanged } from "../context/index.js";
import { detectToolchain, scanRepository } from "../repo/index.js";
import { createProvider } from "../providers/index.js";
import { findPrompt, promptRef, renderPrompt } from "../prompts/index.js";
import { requireConfig, requireWorkspace } from "./command.js";
import type { PackedContext } from "../context/index.js";
import type { CompletionResult } from "../providers/index.js";
import type { CommandContext } from "./command.js";

export interface AiRequest {
  /** Prompt id from the registry, rendered with `context` plus any extras. */
  readonly promptId: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly focus?: readonly string[];
  readonly maxTokens?: number;
}

export interface AiOutcome {
  readonly result: CompletionResult;
  readonly packed: PackedContext;
  /** e.g. `review@1`, recorded so a run can name what produced it. */
  readonly promptRef: string;
  readonly systemRef: string;
}

export const DEFAULT_MAX_TOKENS = 8000;

export async function completeWithContext(
  context: CommandContext,
  request: AiRequest,
): Promise<AiOutcome> {
  const workspace = requireWorkspace(context);
  const config = requireConfig(context);

  const scan = scanRepository({
    root: workspace.root,
    fs: context.hosts.fs,
    ignore: config.values.ignore,
  });
  const toolchain = detectToolchain(context.hosts.fs, workspace.root);

  const packed = packContext({
    root: workspace.root,
    fs: context.hosts.fs,
    scan,
    toolchain,
    budget: config.values.contextBudget,
    ...(request.focus === undefined ? {} : { focus: request.focus }),
    recent: recentlyChanged(context.hosts.proc, workspace.root),
  });

  const system = renderPrompt("system", {
    repository: workspace.root,
    ecosystem: toolchain.ecosystem,
  });

  const user = renderPrompt(request.promptId, {
    context: packed.text,
    ...request.variables,
  });

  const provider = createProvider(config.values.provider, {
    env: context.hosts.env,
    http: context.hosts.http,
    model: config.values.model,
  });

  context.logger.debug(
    `${provider.id}: ${String(packed.tokens)} context tokens, prompt ${request.promptId}`,
  );

  const result = await provider.complete({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  });

  const prompt = findPrompt(request.promptId);
  const systemPrompt = findPrompt("system");

  return {
    result,
    packed,
    promptRef: prompt === undefined ? request.promptId : promptRef(prompt),
    systemRef: systemPrompt === undefined ? "system" : promptRef(systemPrompt),
  };
}
