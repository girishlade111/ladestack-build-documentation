import { z } from "zod";
import { ToolDefinition } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

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

export const writeTool: ToolDefinition = {
  name: "write",
  description: "Write content to a file in the project workspace. Creates directories as needed.",
  parameters: z.object({
    filePath: z.string().min(1, "filePath is required"),
    content: z.string(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { filePath, content } = args as { filePath: string; content: string };
    const root = getWorkspaceRoot();
    const resolvedPath = path.resolve(filePath);

    if (!isPathWithinRoot(resolvedPath, root)) {
      return {
        error: "Access denied: file path is outside the project workspace",
        path: filePath,
      };
    }

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const previousContent = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, "utf-8") : null;

    fs.writeFileSync(resolvedPath, content, "utf-8");

    const result: Record<string, unknown> = {
      success: true,
      path: filePath,
      resolvedPath,
      action: previousContent === null ? "created" : "updated",
      size: Buffer.byteLength(content, "utf-8"),
    };

    if (previousContent !== null) {
      const prevLines = previousContent.split("\n");
      const newLines = content.split("\n");
      result.previousLines = prevLines.length;
      result.newLines = newLines.length;
      result.diffLines = newLines.length - prevLines.length;
    }

    return result;
  },
};
