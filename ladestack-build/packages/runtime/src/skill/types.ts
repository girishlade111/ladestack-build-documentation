import { z } from "zod";
import { ToolDefinition } from "../tool/types.js";
import { AgentDefinition } from "../agent/types.js";

export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  tools?: ToolDefinition[];
  agents?: AgentDefinition[];
  systemPrompts?: Record<string, string>;
  config?: Record<string, unknown>;
  dependencies?: string[];
}

export interface BundleDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  skills: string[];
  dependencies?: string[];
  config?: Record<string, unknown>;
}

export const SkillDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  author: z.string().optional(),
  tools: z.array(z.any()).optional(),
  agents: z.array(z.any()).optional(),
  systemPrompts: z.record(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  dependencies: z.array(z.string()).optional(),
});

export const BundleDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  skills: z.array(z.string()).min(1),
  dependencies: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});
