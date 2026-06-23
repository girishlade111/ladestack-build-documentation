import { z } from "zod";
import { ToolDefinition } from "../types.js";
import * as readline from "node:readline";

export const askTool: ToolDefinition = {
  name: "ask",
  description: "Ask the user a question and get their response. Use for clarification, approval, or input gathering.",
  parameters: z.object({
    question: z.string().min(1, "Question is required"),
    options: z.array(z.string()).optional(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { question, options } = args as { question: string; options?: string[] };

    let prompt = `\n=== QUESTION ===\n${question}\n`;

    if (options && options.length > 0) {
      prompt += "\n\nOptions:\n";
      options.forEach((opt, i) => {
        prompt += `  ${i + 1}. ${opt}\n`;
      });
      prompt += "\nEnter choice number or your response: ";
    } else {
      prompt += "\nYour response: ";
    }

    if (!process.stdin.isTTY) {
      return {
        answer: null,
        message: "Cannot prompt user in non-interactive mode. Please run in an interactive terminal.",
        interactive: false,
      };
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();

        let selectedOption: string | undefined;
        if (options && options.length > 0) {
          const num = parseInt(answer, 10);
          if (num >= 1 && num <= options.length) {
            selectedOption = options[num - 1];
          }
        }

        resolve({
          answer: selectedOption || answer.trim(),
          rawAnswer: answer.trim(),
          selectedOption,
          question,
          interactive: true,
        });
      });
    });
  },
};
