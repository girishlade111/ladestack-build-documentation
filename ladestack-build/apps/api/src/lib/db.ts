import { promises as fs } from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "projects.json");

interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  sandboxPath: string;
  createdAt: number;
  updatedAt: number;
}

class JsonFileStore {
  private cache: Map<string, ProjectRecord> | null = null;

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true }).catch(() => {});
    try {
      const raw = await fs.readFile(DB_PATH, "utf-8");
      const arr: ProjectRecord[] = JSON.parse(raw);
      this.cache = new Map(arr.map((p) => [p.id, p]));
    } catch {
      this.cache = new Map();
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.cache) return;
    const arr = Array.from(this.cache.values());
    await fs.writeFile(DB_PATH, JSON.stringify(arr, null, 2), "utf-8");
  }

  all(): ProjectRecord[] {
    return this.cache ? Array.from(this.cache.values()) : [];
  }

  get(id: string): ProjectRecord | undefined {
    return this.cache?.get(id);
  }

  async set(id: string, project: ProjectRecord): Promise<void> {
    this.cache?.set(id, project);
    await this.flush();
  }

  async delete(id: string): Promise<void> {
    this.cache?.delete(id);
    await this.flush();
  }
}

const store = new JsonFileStore();

export { store, JsonFileStore };
export type { ProjectRecord };
