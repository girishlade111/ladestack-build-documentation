import { AgentDefinition, AgentManifest } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private manifests = new Map<string, AgentManifest>();

  registerAgent(definition: AgentDefinition, manifest?: Partial<AgentManifest>): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent "${definition.id}" is already registered`);
    }
    this.agents.set(definition.id, definition);

    if (manifest) {
      this.manifests.set(definition.id, {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        version: manifest.version || "1.0.0",
        author: manifest.author,
        tags: manifest.tags,
        capabilities: manifest.capabilities || definition.tools,
        definition,
        created: manifest.created || new Date().toISOString(),
        updated: manifest.updated || new Date().toISOString(),
      });
    }
  }

  getAgent(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  getAgentManifest(id: string): AgentManifest | undefined {
    return this.manifests.get(id);
  }

  getAllManifests(): AgentManifest[] {
    return Array.from(this.manifests.values());
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  removeAgent(id: string): boolean {
    this.manifests.delete(id);
    return this.agents.delete(id);
  }

  findAgentsByTool(toolName: string): AgentDefinition[] {
    return this.getAllAgents().filter((a) => a.tools.includes(toolName));
  }

  findAgentsByCapability(capability: string): AgentDefinition[] {
    return this.getAllAgents().filter((a) => {
      const manifest = this.manifests.get(a.id);
      return manifest?.capabilities?.includes(capability);
    });
  }

  discoverAgents(skillsDir?: string): AgentDefinition[] {
    const discovered: AgentDefinition[] = [];
    const searchPaths = skillsDir ? [skillsDir] : [];

    const cwd = process.cwd();
    const possibleDirs = [
      path.join(cwd, "skills"),
      path.join(cwd, "agents"),
      path.join(cwd, ".ladestack", "agents"),
      path.join(cwd, ".agents"),
    ];

    searchPaths.push(...possibleDirs);

    for (const dir of searchPaths) {
      if (!fs.existsSync(dir)) continue;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const agentFile = path.join(dir, entry.name, "agent.json");
          const agentFile2 = path.join(dir, entry.name, "agent.yaml");
          const agentTs = path.join(dir, entry.name, "index.ts");

          if (fs.existsSync(agentFile)) {
            try {
              const content = fs.readFileSync(agentFile, "utf-8");
              const manifest = JSON.parse(content) as AgentManifest;
              if (manifest.definition) {
                this.registerAgent(manifest.definition, manifest);
                discovered.push(manifest.definition);
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      } catch {
        // Permission denied, skip
      }
    }

    return discovered;
  }

  clear(): void {
    this.agents.clear();
    this.manifests.clear();
  }
}

export const agentRegistry = new AgentRegistry();
export { AgentRegistry };
