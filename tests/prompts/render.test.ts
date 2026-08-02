import { describe, expect, it } from "vitest";
import {
  placeholdersOf,
  PROMPTS,
  PromptError,
  promptRef,
  loadTemplate,
  renderPrompt,
  renderTemplate,
} from "../../src/prompts/index.js";

describe("renderTemplate", () => {
  it("substitutes placeholders", () => {
    expect(renderTemplate("Hello {{name}} and {{name}}", { name: "world" })).toBe(
      "Hello world and world",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{ name }}", { name: "x" })).toBe("x");
  });

  it("refuses to render with a missing variable", () => {
    expect(() => renderTemplate("{{a}} {{b}}", { a: "1" })).toThrow(PromptError);
    expect(() => renderTemplate("{{a}} {{b}}", { a: "1" })).toThrow(/b/);
  });

  it("refuses unused variables so typos surface", () => {
    expect(() => renderTemplate("{{a}}", { a: "1", typo: "2" })).toThrow(
      /Unused/,
    );
  });

  it("leaves fenced code blocks intact", () => {
    const template = "Before\n```ts\nconst x = 1;\n```\n{{tail}}";

    expect(renderTemplate(template, { tail: "after" })).toContain("```ts");
  });

  it("lists placeholders in order of first appearance", () => {
    expect(placeholdersOf("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
  });
});

describe("prompt registry", () => {
  it("renders every registered prompt from its declared variables", () => {
    for (const prompt of PROMPTS) {
      const template = loadTemplate(prompt.id);
      const variables = Object.fromEntries(
        placeholdersOf(template).map((name) => [name, `<${name}>`]),
      );

      expect(renderPrompt(prompt.id, variables)).not.toContain("{{");
    }
  });

  it("versions prompts so a run can name what produced it", () => {
    expect(promptRef(PROMPTS[0]!)).toMatch(/^[a-z]+@\d+$/);
  });

  it("rejects an unknown prompt and lists the known ids", () => {
    try {
      renderPrompt("nope", {});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as PromptError).message).toContain("nope");
      expect((error as PromptError).hint).toContain("system");
    }
  });

  it("keeps the system prompt's rules stable", () => {
    const rendered = renderPrompt("system", {
      repository: "/repo",
      ecosystem: "node",
    });

    // Snapshot of intent rather than wording: these rules are load bearing.
    expect(rendered).toContain("A human reviews everything you produce");
    expect(rendered).toContain("Work only from the repository content provided");
    expect(rendered).toContain("Repository: /repo");
    expect(rendered).toContain("Ecosystem: node");
  });
});
