import { describe, it, expect } from "vitest";
import { loadPrompt } from "./loader.js";
import { composeSystemPrompt, renderEnvironment } from "./compose.js";

describe("prompt system", () => {
  it("loads the soul prompt", () => {
    const soul = loadPrompt("soul");
    expect(soul).toContain("Lade");
    expect(soul).toContain("LadeStack Build");
  });

  it("loads the build prompt", () => {
    const build = loadPrompt("build");
    expect(build).toContain("code-writing");
  });

  it("loads the plan prompt", () => {
    const plan = loadPrompt("plan");
    expect(plan).toContain("PLAN MODE");
  });

  it("loads the explore prompt", () => {
    const explore = loadPrompt("explore");
    expect(explore).toContain("file search specialist");
  });

  it("loads the scout prompt", () => {
    const scout = loadPrompt("scout");
    expect(scout).toContain("code scout");
  });

  it("loads the summarize prompt", () => {
    const summarize = loadPrompt("summarize");
    expect(summarize).toContain("conversation summarizer");
  });

  it("loads the title prompt", () => {
    const title = loadPrompt("title");
    expect(title).toContain("concise titles");
  });

  it("loads the environment template", () => {
    const env = loadPrompt("environment");
    expect(env).toContain("{{cwd}}");
    expect(env).toContain("{{projectType}}");
  });

  it("loads the tools template", () => {
    const tools = loadPrompt("tools");
    expect(tools).toContain("read");
    expect(tools).toContain("Writes a file");
  });

  it("composes a full prompt for builder agent", () => {
    const prompt = composeSystemPrompt("builder", {
      environment: { cwd: "/test" },
    });
    expect(prompt).toContain("Lade");
    expect(prompt).toContain("code-writing");
    expect(prompt).toContain("read");
    expect(prompt).toContain("/test");
    expect(prompt).toContain("Sandbox");
  });

  it("composes a prompt with agent-to-file mapping", () => {
    const plannerPrompt = composeSystemPrompt("planner");
    expect(plannerPrompt).toContain("PLAN MODE");
  });

  it("throws for missing prompt", () => {
    expect(() => loadPrompt("nonexistent")).toThrow();
  });

  it("renders environment context", () => {
    const env = renderEnvironment({
      cwd: "/workspace",
      date: "2026-06-22",
      platform: "linux x86_64",
      runtime: "Node.js 20.11.0",
      projectName: "test-project",
      projectType: "Next.js 14",
      defaultMode: "plan",
    });
    expect(env).toContain("/workspace");
    expect(env).toContain("2026-06-22");
    expect(env).toContain("linux x86_64");
    expect(env).toContain("test-project");
    expect(env).toContain("Next.js 14");
    expect(env).toContain("plan");
  });
});
