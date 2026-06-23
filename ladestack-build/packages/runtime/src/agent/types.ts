import { z } from "zod";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  subAgents?: string[];
  maxSteps: number;
  temperature?: number;
  model?: string;
  config?: Record<string, unknown>;
}

export interface AgentManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  capabilities?: string[];
  definition: AgentDefinition;
  created?: string;
  updated?: string;
}

export const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()).default([]),
  subAgents: z.array(z.string()).optional(),
  maxSteps: z.number().int().positive().default(25),
  temperature: z.number().min(0).max(2).optional(),
  model: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export const AgentManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  definition: AgentDefinitionSchema,
  created: z.string().optional(),
  updated: z.string().optional(),
});
