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

function parseUnifiedDiff(patch: string): Array<{
  originalFile: string;
  newFile: string;
  hunks: Array<{ oldStart: number; oldLines: number[]; newLines: string[] }>;
}> {
  const files: Array<{
    originalFile: string;
    newFile: string;
    hunks: Array<{ oldStart: number; oldLines: number[]; newLines: string[] }>;
  }> = [];

  const lines = patch.split("\n");
  let currentFile: {
    originalFile: string;
    newFile: string;
    hunks: Array<{ oldStart: number; oldLines: number[]; newLines: string[] }>;
  } | null = null;
  let currentHunk: {
    oldStart: number;
    oldLines: number[];
    newLines: string[];
  } | null = null;

  for (const line of lines) {
    const diffMatch = line.match(/^--- (?:a\/(.+)|(.+))$/);
    const newFileMatch = line.match(/^\+\+\+ (?:b\/(.+)|(.+))$/);
    const hunkMatch = line.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/);

    if (diffMatch) {
      if (currentFile) files.push(currentFile);
      currentFile = {
        originalFile: diffMatch[1] || diffMatch[2],
        newFile: "",
        hunks: [],
      };
    } else if (newFileMatch && currentFile) {
      currentFile.newFile = newFileMatch[1] || newFileMatch[2];
    } else if (hunkMatch && currentFile) {
      if (currentHunk) currentFile.hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: [],
        newLines: [],
      };
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        currentHunk.oldLines.push(currentHunk.oldStart + currentHunk.oldLines.length);
      } else if (line.startsWith(" ")) {
        currentHunk.oldLines.push(currentHunk.oldStart + currentHunk.oldLines.length);
        currentHunk.newLines.push(line.slice(1));
      }
    }
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return files;
}

function applyHunk(content: string[], hunk: { oldStart: number; oldLines: number[]; newLines: string[] }): string[] {
  const result = [...content];
  const linesToRemove = hunk.oldLines.length;
  const insertLine = hunk.oldStart - 1;

  if (linesToRemove > 0) {
    result.splice(insertLine, linesToRemove, ...hunk.newLines);
  } else {
    result.splice(insertLine, 0, ...hunk.newLines);
  }

  return result;
}

export const applyPatchTool: ToolDefinition = {
  name: "apply-patch",
  description: "Apply a unified diff patch to a file. Handles standard diff/patch format for making multiple changes.",
  parameters: z.object({
    filePath: z.string().min(1, "filePath is required"),
    patch: z.string().min(1, "Patch content is required"),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { filePath, patch } = args as { filePath: string; patch: string };

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

    const originalContent = fs.readFileSync(resolvedPath, "utf-8");
    const contentLines = originalContent.split("\n");
    const parsedPatches = parseUnifiedDiff(patch);

    if (parsedPatches.length === 0) {
      return {
        error: "Could not parse patch. Patch must be in unified diff format.",
        path: filePath,
      };
    }

    const filePatch = parsedPatches[0]!;
    let modifiedContent = [...contentLines];
    const appliedHunks: Array<{ hunkIndex: number; oldStart: number; changes: number }> = [];

    for (let i = 0; i < filePatch.hunks.length; i++) {
      const hunk = filePatch.hunks[i]!;

      if (hunk.oldStart - 1 > modifiedContent.length) {
        return {
          error: `Hunk ${i + 1}: Start line ${hunk.oldStart} exceeds file length ${modifiedContent.length}`,
          path: filePath,
        };
      }

      modifiedContent = applyHunk(modifiedContent, hunk);
      appliedHunks.push({ hunkIndex: i, oldStart: hunk.oldStart, changes: hunk.newLines.length - hunk.oldLines.length });
    }

    const newContent = modifiedContent.join("\n");
    fs.writeFileSync(resolvedPath, newContent, "utf-8");

    return {
      success: true,
      path: filePath,
      hunksApplied: appliedHunks.length,
      totalChanges: appliedHunks.reduce((sum, h) => sum + h.changes, 0),
      oldSize: originalContent.length,
      newSize: newContent.length,
      appliedHunks,
    };
  },
};
