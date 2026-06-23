import { z } from "zod";
import { ToolDefinition } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

function globSync(pattern: string, dirPath: string): string[] {
  const parts = pattern.replace(/\\/g, "/").split("/");
  const results: string[] = [];

  function match(dir: string, patternParts: string[]): void {
    const current = patternParts[0];
    if (!current) {
      const relative = path.relative(dirPath, dir) || ".";
      results.push(relative.replace(/\\/g, "/"));
      return;
    }

    if (current === "**") {
      match(dir, patternParts.slice(1));
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            match(path.join(dir, entry.name), patternParts);
            match(path.join(dir, entry.name), ["**", ...patternParts.slice(1)]);
          }
        }
      } catch {
        return;
      }
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);

        if (current === "*") {
          match(entryPath, patternParts.slice(1));
        } else if (current === "?") {
          if (entry.name.length === 1) {
            match(entryPath, patternParts.slice(1));
          }
        } else if (current.startsWith("*.")) {
          const ext = current.slice(1);
          if (entry.name.endsWith(ext)) {
            match(entryPath, patternParts.slice(1));
          }
        } else if (current.endsWith("/*")) {
          if (entry.isDirectory()) {
            match(entryPath, patternParts.slice(1));
          }
        } else {
          const regex = new RegExp(
            "^" + current.replace(/\*\*/g, "___DOUBLESTAR___").replace(/\*/g, "[^/]*").replace(/___DOUBLESTAR___/g, ".*") + "$"
          );
          if (regex.test(entry.name)) {
            match(entryPath, patternParts.slice(1));
          }
        }

        if (entry.isDirectory() && patternParts.length > 1) {
          match(entryPath, patternParts);
        }
      }
    } catch {
      return;
    }
  }

  const resolvedRoot = path.resolve(dirPath);
  if (!fs.existsSync(resolvedRoot)) return [];
  match(resolvedRoot, parts);
  return results;
}

export const globTool: ToolDefinition = {
  name: "glob",
  description: "Search for files matching a glob pattern. Returns matching file paths relative to the search directory.",
  parameters: z.object({
    pattern: z.string().min(1, "Glob pattern is required"),
    path: z.string().optional(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { pattern, path: searchPath } = args as { pattern: string; path?: string };

    const root = process.cwd();
    const searchDir = searchPath ? path.resolve(root, searchPath) : root;

    if (!fs.existsSync(searchDir)) {
      return { error: `Directory not found: ${searchPath || root}`, files: [] };
    }

    const files = globSync(pattern, searchDir);
    return { files, count: files.length, pattern, searchDir };
  },
};
