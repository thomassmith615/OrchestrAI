/**
 * Provider invocation with packed context.
 *
 * One place where scanning, ranking, prompt rendering, and the provider call
 * come together, so that every command that talks to a model does it the same
 * way and records the same metadata.
 */
import { packContext, recentlyChanged } from "../context/index.js";
import { detectToolchain, scanRepository } from "../repo/index.js";
import { createProvider, estimateCost, isRetryable, withRetry } from "../providers/index.js";
import { defaultRetriever, readMemory, recordUsage } from "../memory/index.js";
import { findPrompt, promptRef, renderPrompt } from "../prompts/index.js";
import { requireConfig, requireWorkspace } from "./command.js";
import type { PackedContext } from "../context/index.js";
import type { CompletionResult } from "../providers/index.js";
import type { CommandContext } from "./command.js";
import type { AiCall, AiPort, AiReply } from "../workflow/index.js";

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
  /** Ids of the memory records recalled into the context. */
  readonly recalled: readonly string[];
  readonly retries: number;
  /** True when the primary provider failed and the fallback answered. */
  readonly fellBack: boolean;
  /** Null when the model has no known rate. */
  readonly costUsd: number | null;
  /** e.g. `review@1`, recorded so a run can name what produced it. */
  readonly promptRef: string;
  readonly systemRef: string;
}

export const DEFAULT_MAX_TOKENS = 8000;

/**
 * Adapter from the engine to the workflow's `AiPort`. The workflow declares
 * what it needs from a model; this supplies it without the workflow ever
 * seeing a provider or a command context.
 */
export function aiPort(
  context: CommandContext,
  defaults: { readonly maxTokens?: number } = {},
): AiPort {
  return async (call: AiCall): Promise<AiReply> => {
    const outcome = await completeWithContext(context, {
      promptId: call.promptId,
      ...(call.variables === undefined ? {} : { variables: call.variables }),
      ...(call.focus === undefined ? {} : { focus: call.focus }),
      ...(call.maxTokens ?? defaults.maxTokens
        ? { maxTokens: call.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS }
        : {}),
    });

    return {
      text: outcome.result.text,
      provider: outcome.result.provider,
      model: outcome.result.model,
      promptRef: outcome.promptRef,
      contextTokens: outcome.packed.tokens,
      usage: outcome.result.usage,
    };
  };
}

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

  // Recall runs before packing so that what memory contributes is budgeted
  // alongside the files rather than appended after the fact.
  const query = [
    request.variables?.["task"] ?? "",
    request.variables?.["objective"] ?? "",
    ...(request.focus ?? []),
  ]
    .join(" ")
    .trim();

  const recalled =
    query.length === 0
      ? []
      : defaultRetriever.search(
          query,
          readMemory(context.hosts.fs, workspace.stateDir).records,
          { limit: 5, now: context.hosts.clock.now() },
        );

  const packed = packContext({
    root: workspace.root,
    fs: context.hosts.fs,
    scan,
    toolchain,
    budget: config.values.contextBudget,
    ...(request.focus === undefined ? {} : { focus: request.focus }),
    recent: recentlyChanged(context.hosts.proc, workspace.root),
    notes: recalled.map((entry) => ({
      title: `${entry.record.kind}: ${entry.record.title}`,
      body: entry.record.body,
    })),
  });

  const system = renderPrompt("system", {
    repository: workspace.root,
    ecosystem: toolchain.ecosystem,
  });

  const user = renderPrompt(request.promptId, {
    context: packed.text,
    ...request.variables,
  });

  const completion = {
    system,
    messages: [{ role: "user" as const, content: user }],
    maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  const providerOptions = {
    env: context.hosts.env,
    http: context.hosts.http,
    model: config.values.model,
    baseUrl: config.values.baseUrl,
    timeoutMs: config.values.requestTimeout * 1000,
  };

  context.logger.debug(
    `${config.values.provider}: ${String(packed.tokens)} context tokens, prompt ${request.promptId}`,
  );

  let retries = 0;
  let fellBack = false;

  const call = async (id: string): Promise<CompletionResult> =>
    withRetry(
      () => createProvider(id, providerOptions).complete(completion),
      {
        policy: {
          maxRetries: config.values.maxRetries,
          baseDelayMs: 500,
          maxDelayMs: 30_000,
        },
        onRetry: (attempt) => {
          retries += 1;
          context.logger.warn(
            `${id} ${attempt.error.kind}, retry ${String(attempt.attempt)} in ${String(attempt.delayMs)}ms`,
          );
        },
      },
    );

  let result: CompletionResult;

  try {
    result = await call(config.values.provider);
  } catch (error: unknown) {
    const fallback = config.values.fallbackProvider;

    // Failover only for failures a different provider could plausibly survive.
    // A malformed request will fail identically everywhere.
    if (fallback === null || fallback === config.values.provider || !isRetryable(error)) {
      throw error;
    }

    context.logger.warn(
      `${config.values.provider} unavailable, falling back to ${fallback}`,
    );
    fellBack = true;
    result = await call(fallback);
  }

  const costUsd = estimateCost(result.model, result.usage);

  const prompt = findPrompt(request.promptId);
  const systemPrompt = findPrompt("system");
  const reference = prompt === undefined ? request.promptId : promptRef(prompt);

  // Every call is ledgered, including ones that failed over or retried, so the
  // record reflects what was actually spent rather than what was intended.
  recordUsage(context.hosts.fs, workspace.stateDir, {
    at: context.hosts.clock.now(),
    provider: result.provider,
    model: result.model,
    promptRef: reference,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd,
    retries,
    fellBack,
  });

  return {
    result,
    packed,
    recalled: recalled.map((entry) => entry.record.id),
    retries,
    fellBack,
    costUsd,
    promptRef: reference,
    systemRef: systemPrompt === undefined ? "system" : promptRef(systemPrompt),
  };
}
