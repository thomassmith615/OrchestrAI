/**
 * The event bus.
 *
 * A synchronous, in-process, typed emitter capabilities can use to
 * communicate without knowing about each other. "Synchronous" means
 * in-process and immediate — not queued, not persisted, not distributed —
 * not that handlers can't be async: `emit` awaits every handler in
 * registration order before it resolves.
 *
 * Event names are a convention, `<capability>.<noun>.<verb>`
 * (`engineering.milestone.completed`), not an enforced namespace: the bus
 * does not parse, validate, or reserve any name. What it guarantees is
 * narrower and more load-bearing than namespacing would be — one
 * capability's broken handler can never break another's, or the emitter
 * that called it. See ADR 0020.
 */
import type { Logger } from "../core/logger.js";

export type EventHandler<TPayload = unknown> = (
  payload: TPayload,
) => void | Promise<void>;

export interface EventBusOptions {
  readonly logger: Logger;
}

export class EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly logger: Logger;

  constructor(options: EventBusOptions) {
    this.logger = options.logger;
  }

  /** Registers `handler` for `name`. Returns a function that removes it. */
  on<TPayload = unknown>(name: string, handler: EventHandler<TPayload>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(name, list);

    return (): void => {
      const current = this.handlers.get(name);
      if (current === undefined) {
        return;
      }
      const index = current.indexOf(handler as EventHandler);
      if (index >= 0) {
        current.splice(index, 1);
      }
    };
  }

  /**
   * Runs every handler registered for `name`, in registration order,
   * awaiting each. A handler that throws or rejects is logged as a warning
   * — the same tolerance the plugin loader applies to a failed plugin — and
   * does not stop the remaining handlers from running or `emit` from
   * resolving.
   */
  async emit<TPayload = unknown>(name: string, payload: TPayload): Promise<void> {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        await handler(payload);
      } catch (error: unknown) {
        this.logger.warn(
          `event ${name}: handler failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Number of handlers currently registered for `name`. Mostly for tests. */
  listenerCount(name: string): number {
    return this.handlers.get(name)?.length ?? 0;
  }
}
