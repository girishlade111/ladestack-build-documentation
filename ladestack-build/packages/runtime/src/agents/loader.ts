import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTS_DIR = join(__dirname, "prompts");

export function loadPrompt(name: string): string {
  const filePath = join(PROMPTS_DIR, `${name}.txt`);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Prompt not found: ${name} (${filePath})`);
  }
}
