import { z } from "zod";
import { ToolDefinition } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const READ_PARAMS = {
  filePath: z.string().min(1, "filePath is required"),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
};

function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json"))) return cwd;
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return cwd;
}

function isPathWithinRoot(target: string, root: string): boolean {
  const resolved = path.resolve(target);
  const normalizedRoot = path.resolve(root);
  return resolved.startsWith(normalizedRoot + path.sep) || resolved === normalizedRoot;
}

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read the contents of a file from the project workspace. Returns file contents with line numbers.",
  parameters: z.object(READ_PARAMS),
  execute: async (args: Record<string, unknown>) => {
    const { filePath, offset, limit } = args as z.infer<z.ZodObject<typeof READ_PARAMS>>;
    const root = getWorkspaceRoot();
    const resolvedPath = path.resolve(filePath);

    if (!isPathWithinRoot(resolvedPath, root) && !isPathWithinRoot(resolvedPath, path.resolve(root, ".."))) {
      return {
        error: "Access denied: file path is outside the project workspace",
        path: filePath,
        resolvedPath,
        root,
      };
    }

    if (!fs.existsSync(resolvedPath)) {
      return { error: `File not found: ${filePath}`, path: filePath };
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolvedPath);
      return {
        type: "directory",
        path: filePath,
        entries: entries.map((e) => {
          const fullPath = path.join(resolvedPath, e);
          const isDir = fs.statSync(fullPath).isDirectory();
          return isDir ? `${e}/` : e;
        }),
      };
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (offset !== undefined && limit !== undefined) {
      const start = offset;
      const end = Math.min(start + limit, totalLines);
      const sliced = lines.slice(start, end);

      return {
        type: "file",
        path: filePath,
        totalLines,
        startLine: start,
        endLine: end - 1,
        content: sliced.map((line, i) => `${start + i}: ${line}`).join("\n"),
        truncated: end < totalLines,
      };
    }

    const MAX_LINES = 2000;
    if (totalLines > MAX_LINES) {
      return {
        type: "file",
        path: filePath,
        totalLines,
        startLine: 0,
        endLine: MAX_LINES - 1,
        content: lines.slice(0, MAX_LINES).map((line, i) => `${i}: ${line}`).join("\n"),
        truncated: true,
        message: `File has ${totalLines} lines, showing first ${MAX_LINES}. Use offset and limit parameters to read more.`,
      };
    }

    return {
      type: "file",
      path: filePath,
      totalLines,
      startLine: 0,
      endLine: totalLines - 1,
      content: lines.map((line, i) => `${i}: ${line}`).join("\n"),
      truncated: false,
    };
  },
};
