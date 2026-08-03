import { describe, expect, it } from "vitest";
import { EventBus } from "../../src/runtime/events.js";
import { createLogger } from "../../src/core/logger.js";
import { recordingSink } from "../support/fakes.js";

function busWithLogger(): { bus: EventBus; warnings: () => string } {
  const err = recordingSink();
  const logger = createLogger({ level: "debug", err, out: recordingSink() });
  return { bus: new EventBus({ logger }), warnings: () => err.text() };
}

describe("EventBus", () => {
  it("delivers an event to every registered handler, in order", async () => {
    const { bus } = busWithLogger();
    const calls: string[] = [];

    bus.on("engineering.milestone.completed", () => {
      calls.push("first");
    });
    bus.on("engineering.milestone.completed", () => {
      calls.push("second");
    });

    await bus.emit("engineering.milestone.completed", { id: "M1" });

    expect(calls).toEqual(["first", "second"]);
  });

  it("lets two unrelated capabilities communicate without knowing about each other", async () => {
    // The proof: a listener registered under one name, an emitter under
    // another, sharing only the bus instance — nothing here knows it is
    // "Engineering" or "Home", or that the other side exists.
    const { bus } = busWithLogger();
    let received: unknown;

    bus.on("home.document.indexed", (payload) => {
      received = payload;
    });

    await bus.emit("home.document.indexed", { path: "/inbox/note.md" });

    expect(received).toEqual({ path: "/inbox/note.md" });
  });

  it("does not deliver an event to handlers registered under a different name", async () => {
    const { bus } = busWithLogger();
    let firedWrongName = false;

    bus.on("engineering.milestone.completed", () => {
      firedWrongName = true;
    });

    await bus.emit("home.document.indexed", {});

    expect(firedWrongName).toBe(false);
  });

  it("awaits async handlers before emit resolves", async () => {
    const { bus } = busWithLogger();
    let resolved = false;

    bus.on("engineering.milestone.completed", async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolved = true;
    });

    await bus.emit("engineering.milestone.completed", {});

    expect(resolved).toBe(true);
  });

  it("logs a failing handler as a warning without stopping the rest or rejecting", async () => {
    const { bus, warnings } = busWithLogger();
    let secondRan = false;

    bus.on("engineering.milestone.completed", () => {
      throw new Error("boom");
    });
    bus.on("engineering.milestone.completed", () => {
      secondRan = true;
    });

    await expect(bus.emit("engineering.milestone.completed", {})).resolves.toBeUndefined();

    expect(secondRan).toBe(true);
    expect(warnings()).toContain("boom");
  });

  it("logs a rejecting async handler the same way as a throwing one", async () => {
    const { bus, warnings } = busWithLogger();

    bus.on("home.document.indexed", () => Promise.reject(new Error("index failed")));

    await bus.emit("home.document.indexed", {});

    expect(warnings()).toContain("index failed");
  });

  it("removes a handler when its unsubscribe function is called", async () => {
    const { bus } = busWithLogger();
    let calls = 0;

    const unsubscribe = bus.on("engineering.milestone.completed", () => {
      calls += 1;
    });
    unsubscribe();

    await bus.emit("engineering.milestone.completed", {});

    expect(calls).toBe(0);
  });

  it("reports the listener count for a name", () => {
    const { bus } = busWithLogger();

    expect(bus.listenerCount("engineering.milestone.completed")).toBe(0);
    bus.on("engineering.milestone.completed", () => {});
    expect(bus.listenerCount("engineering.milestone.completed")).toBe(1);
  });
});
