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

export const editTool: ToolDefinition = {
  name: "edit",
  description: "Performs surgical text replacement in a file. Replaces the first occurrence of oldString with newString. Use for targeted edits.",
  parameters: z.object({
    filePath: z.string().min(1, "filePath is required"),
    oldString: z.string().min(1, "oldString is required"),
    newString: z.string(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { filePath, oldString, newString } = args as {
      filePath: string;
      oldString: string;
      newString: string;
    };

    const root = getWorkspaceRoot();
    const resolvedPath = path.resolve(filePath);

    if (!isPathWithinRoot(resolvedPath, root)) {
      return {
        error: "Access denied: file path is outside the project workspace",
        path: filePath,
      };
    }

    if (!fs.existsSync(resolvedPath)) {
      return { error: `File not found: ${filePath}`, path: filePath };
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");

    const matchIndex = content.indexOf(oldString);
    if (matchIndex === -1) {
      return {
        error: `Could not find oldString in file: ${filePath}`,
        path: filePath,
        oldString: oldString.length > 100 ? oldString.slice(0, 100) + "..." : oldString,
      };
    }

    const secondMatchIndex = content.indexOf(oldString, matchIndex + 1);
    if (secondMatchIndex !== -1) {
      return {
        error: `Found multiple matches for oldString in file: ${filePath}. Please provide more surrounding context to identify the correct match.`,
        path: filePath,
        matches: 2,
      };
    }

    const newContent = content.replace(oldString, newString);
    fs.writeFileSync(resolvedPath, newContent, "utf-8");

    const oldLines = content.substring(0, matchIndex).split("\n").length;
    const replacementLines = oldString.split("\n").length;

    return {
      success: true,
      path: filePath,
      type: "edit",
      startLine: oldLines,
      endLine: oldLines + replacementLines - 1,
      oldLength: oldString.length,
      newLength: newString.length,
      diff: newString.length - oldString.length,
    };
  },
};
