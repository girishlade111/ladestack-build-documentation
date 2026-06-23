import * as fs from "node:fs";
import * as path from "node:path";
import { SkillDefinition, BundleDefinition } from "./types.js";
import { toolRegistry } from "../tool/registry.js";
import { agentRegistry } from "../agent/registry.js";
import { ToolDefinition } from "../tool/types.js";
import { AgentDefinition } from "../agent/types.js";

class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private bundles = new Map<string, BundleDefinition>();
  private activeSkills = new Set<string>();

  registerSkill(skill: SkillDefinition): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill "${skill.id}" is already registered`);
    }
    this.skills.set(skill.id, skill);
  }

  registerBundle(bundle: BundleDefinition): void {
    if (this.bundles.has(bundle.id)) {
      throw new Error(`Bundle "${bundle.id}" is already registered`);
    }

    for (const skillId of bundle.skills) {
      if (!this.skills.has(skillId)) {
        throw new Error(`Bundle "${bundle.id}" references unknown skill: ${skillId}`);
      }
    }

    if (bundle.dependencies) {
      for (const dep of bundle.dependencies) {
        if (!this.skills.has(dep) && !this.bundles.has(dep)) {
          throw new Error(`Bundle "${bundle.id}" has unresolved dependency: ${dep}`);
        }
      }
    }

    this.bundles.set(bundle.id, bundle);
  }

  async installSkill(url: string): Promise<SkillDefinition> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill from ${url}: ${response.status}`);
    }

    const text = await response.text();

    let skill: SkillDefinition;
    try {
      skill = JSON.parse(text) as SkillDefinition;
    } catch {
      try {
        skill = JSON.parse(text.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")) as SkillDefinition;
      } catch {
        throw new Error(`Failed to parse skill definition from ${url}`);
      }
    }

    if (!skill.id || !skill.name || !skill.version) {
      throw new Error(`Invalid skill definition from ${url}: missing required fields (id, name, version)`);
    }

    this.registerSkill(skill);

    const cwd = process.cwd();
    const skillsDir = path.join(cwd, "skills", skill.id);
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    fs.writeFileSync(path.join(skillsDir, "skill.json"), JSON.stringify(skill, null, 2), "utf-8");

    return skill;
  }

  discoverSkills(skillsDir?: string): SkillDefinition[] {
    const discovered: SkillDefinition[] = [];
    const cwd = process.cwd();
    const searchPaths = skillsDir ? [skillsDir] : [];

    const possibleDirs = [
      path.join(cwd, "skills"),
      path.join(cwd, ".ladestack", "skills"),
      path.join(cwd, "bundles"),
    ];
    searchPaths.push(...possibleDirs);

    for (const dir of searchPaths) {
      if (!fs.existsSync(dir)) continue;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skillFile = path.join(dir, entry.name, "skill.json");
          const bundleFile = path.join(dir, entry.name, "bundle.json");

          if (fs.existsSync(skillFile)) {
            try {
              const content = fs.readFileSync(skillFile, "utf-8");
              const skill = JSON.parse(content) as SkillDefinition;
              if (!this.skills.has(skill.id)) {
                this.registerSkill(skill);
                discovered.push(skill);
              }
            } catch {
              // Invalid, skip
            }
          }

          if (fs.existsSync(bundleFile)) {
            try {
              const content = fs.readFileSync(bundleFile, "utf-8");
              const bundle = JSON.parse(content) as BundleDefinition;
              if (!this.bundles.has(bundle.id)) {
                this.registerBundle(bundle);
              }
            } catch {
              // Invalid, skip
            }
          }
        }
      } catch {
        // Permission denied, skip
      }
    }

    return discovered;
  }

  getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  getBundle(id: string): BundleDefinition | undefined {
    return this.bundles.get(id);
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  listBundles(): BundleDefinition[] {
    return Array.from(this.bundles.values());
  }

  activateSkill(id: string): { tools: number; agents: number; success: boolean } {
    const skill = this.skills.get(id);
    if (!skill) {
      throw new Error(`Skill "${id}" not found`);
    }

    if (this.activeSkills.has(id)) {
      return { tools: 0, agents: 0, success: true };
    }

    let toolsActivated = 0;
    let agentsActivated = 0;

    if (skill.tools) {
      for (const tool of skill.tools) {
        try {
          toolRegistry.registerTool(tool as unknown as ToolDefinition);
          toolsActivated++;
        } catch {
          // Tool already registered, skip
        }
      }
    }

    if (skill.agents) {
      for (const agent of skill.agents) {
        try {
          agentRegistry.registerAgent(agent as unknown as AgentDefinition);
          agentsActivated++;
        } catch {
          // Agent already registered, skip
        }
      }
    }

    this.activeSkills.add(id);

    return { tools: toolsActivated, agents: agentsActivated, success: true };
  }

  deactivateSkill(id: string): void {
    this.activeSkills.delete(id);
  }

  getActiveSkills(): string[] {
    return Array.from(this.activeSkills);
  }

  hasSkill(id: string): boolean {
    return this.skills.has(id);
  }

  hasBundle(id: string): boolean {
    return this.bundles.has(id);
  }

  clear(): void {
    this.skills.clear();
    this.bundles.clear();
    this.activeSkills.clear();
  }
}

export const skillRegistry = new SkillRegistry();
export { SkillRegistry };
