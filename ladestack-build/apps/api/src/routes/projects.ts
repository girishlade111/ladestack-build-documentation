import { Hono } from "hono";

interface Project {
  id: string;
  name: string;
  description: string;
  sandboxPath: string;
  createdAt: number;
  updatedAt: number;
}

const projects = new Hono();
const store = new Map<string, Project>();

projects.get("/", (c) => {
  const search = c.req.query("search")?.toLowerCase() ?? "";
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10)));

  let all = Array.from(store.values());

  if (search) {
    all = all.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search)
    );
  }

  all.sort((a, b) => b.createdAt - a.createdAt);

  const total = all.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const items = all.slice(offset, offset + limit);

  return c.json({ items, total, page, limit, totalPages });
});

projects.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; description?: string }>();
  const name = body.name?.trim();

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    description: body.description?.trim() ?? "",
    sandboxPath: `sandbox/${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };

  store.set(project.id, project);
  return c.json(project, 201);
});

projects.get("/:id", (c) => {
  const id = c.req.param("id");
  const project = store.get(id);

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(project);
});

projects.put("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = store.get(id);

  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{ name?: string; description?: string }>();

  const updated: Project = {
    ...existing,
    name: body.name?.trim() ?? existing.name,
    description: body.description?.trim() ?? existing.description,
    updatedAt: Date.now(),
  };

  store.set(id, updated);
  return c.json(updated);
});

projects.delete("/:id", (c) => {
  const id = c.req.param("id");

  if (!store.has(id)) {
    return c.json({ error: "Project not found" }, 404);
  }

  store.delete(id);
  return c.json({ success: true });
});

export { projects };
