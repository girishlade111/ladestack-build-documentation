import { ToolRegistry } from "../registry.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { bashTool } from "./bash.js";
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
import { planTool } from "./plan.js";
import { askTool } from "./ask.js";
import { applyPatchTool } from "./apply-patch.js";

export function registerAllTools(registry: ToolRegistry): void {
  registry.registerTool(readTool);
  registry.registerTool(writeTool);
  registry.registerTool(editTool);
  registry.registerTool(globTool);
  registry.registerTool(grepTool);
  registry.registerTool(bashTool);
  registry.registerTool(webSearchTool);
  registry.registerTool(webFetchTool);
  registry.registerTool(planTool);
  registry.registerTool(askTool);
  registry.registerTool(applyPatchTool);
}

export {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  webSearchTool,
  webFetchTool,
  planTool,
  askTool,
  applyPatchTool,
};
