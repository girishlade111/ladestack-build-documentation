import { Hono } from "hono";
import { promises as fs } from "fs";
import * as path from "path";

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  language?: string;
}

const SANDBOX_ROOT = process.env["SANDBOX_DIR"] ?? path.join(process.cwd(), "sandbox");

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  graphql: "graphql",
  svg: "xml",
  xml: "xml",
};

function detectLanguage(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return LANGUAGE_MAP[ext] ?? ext;
}

const files = new Hono();

files.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const projectDir = path.join(SANDBOX_ROOT, projectId);

  try {
    await fs.access(projectDir);
  } catch {
    return c.json({ items: [] });
  }

  async function buildTree(dirPath: string, relativePath: string): Promise<FileNode[]> {
    const entries: FileNode[] = [];
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of dirEntries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = path.join(dirPath, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : `/${entry.name}`;

      if (entry.isDirectory()) {
        const children = await buildTree(fullPath, entryRelativePath);
        entries.push({
          id: entryRelativePath,
          name: entry.name,
          path: entryRelativePath,
          type: "directory",
          children,
        });
      } else {
        entries.push({
          id: entryRelativePath,
          name: entry.name,
          path: entryRelativePath,
          type: "file",
          language: detectLanguage(entry.name),
        });
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  const items = await buildTree(projectDir, "");
  return c.json({ items });
});

files.get("/:projectId/content", async (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("path");

  if (!filePath) {
    return c.json({ error: "path query parameter is required" }, 400);
  }

  const safePath = path.join(SANDBOX_ROOT, projectId, filePath.replace(/^\//, ""));

  try {
    await fs.access(safePath);
    const stat = await fs.stat(safePath);
    if (stat.isDirectory()) {
      return c.json({ error: "path is a directory", isDirectory: true }, 400);
    }
    const content = await fs.readFile(safePath, "utf-8");
    return c.json({
      content,
      language: detectLanguage(path.basename(safePath)),
      path: filePath,
    });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

export { files };
