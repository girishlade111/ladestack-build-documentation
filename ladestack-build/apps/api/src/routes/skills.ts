import { Hono } from "hono";

const skills = new Hono();
const skillStore: { id: string; name: string; description: string; url?: string }[] = [];

skills.get("/", (c) => {
  return c.json({ items: skillStore, total: skillStore.length });
});

skills.post("/install", async (c) => {
  const body = await c.req.json<{ url?: string }>();
  const url = body.url?.trim();

  if (!url) {
    return c.json({ error: "url is required" }, 400);
  }

  const skill = {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    url,
  };

  const match = url.match(/[^/]+(?=\/?$)/);
  if (match) {
    skill.name = match[0].replace(/\.(md|json|yaml)$/, "");
  }
  skill.name ||= `skill-${skillStore.length + 1}`;
  skill.description = `Skill installed from ${url}`;

  skillStore.push(skill);
  return c.json(skill, 201);
});

export { skills };
