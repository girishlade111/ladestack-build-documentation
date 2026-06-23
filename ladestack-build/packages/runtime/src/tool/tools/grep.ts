import { z } from "zod";
import { ToolDefinition } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".turbo",
  "coverage", ".next", ".nuxt", "target",
  "__pycache__", ".cache", ".vscode", "vendor",
]);

function isExcludedDir(dirName: string): boolean {
  return DEFAULT_EXCLUDE_DIRS.has(dirName) || dirName.startsWith(".");
}

function walkDir(dir: string, includeExt?: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) {
          results.push(...walkDir(fullPath, includeExt));
        }
      } else if (entry.isFile()) {
        if (!includeExt || entry.name.endsWith(includeExt.replace("*", ""))) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Permission denied, skip
  }
  return results;
}

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search file contents using a regular expression pattern. Returns matches with file paths and line numbers.",
  parameters: z.object({
    pattern: z.string().min(1, "Search pattern is required"),
    include: z.string().optional(),
    path: z.string().optional(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { pattern, include, path: searchPath } = args as {
      pattern: string;
      include?: string;
      path?: string;
    };

    const root = process.cwd();
    const searchDir = searchPath ? path.resolve(root, searchPath) : root;

    if (!fs.existsSync(searchDir)) {
      return { error: `Directory not found: ${searchPath || root}`, matches: [] };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "g");
    } catch {
      return { error: `Invalid regex pattern: ${pattern}`, matches: [] };
    }

    const files = walkDir(searchDir, include);
    const matches: Array<{ file: string; line: number; column: number; match: string; lineContent: string }> = [];
    const MAX_FILE_SIZE = 1024 * 1024;

    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (stat.size > MAX_FILE_SIZE) continue;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          const line = lines[i]!;
          const match = regex.exec(line);
          if (match) {
            const relativePath = path.relative(root, file).replace(/\\/g, "/");
            const lineContent = line.trim();
            matches.push({
              file: relativePath,
              line: i,
              column: match.index,
              match: match[0],
              lineContent: lineContent.length > 200 ? lineContent.slice(0, 200) + "..." : lineContent,
            });
          }
        }
      } catch {
        // Skip files we can't read
      }
    }

    return {
      matches,
      count: matches.length,
      pattern,
      searchDir,
    };
  },
};
