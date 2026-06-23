import { z } from "zod";
import { ToolDefinition } from "../types.js";
import { spawn } from "node:child_process";
import * as path from "node:path";

const BLOCKED_COMMANDS = [
  "rm -rf /", "rm -rf /*", "rm -rf ~", "rm -rf ~/*",
  "mkfs", "dd if=", "> /dev/sd", ">: /dev/sd",
  "chmod 777 /", "chmod -R 777 /",
  "wget http://", "curl http://",
  ":(){ :|:& };:", "forkbomb",
  "shutdown", "reboot", "halt", "poweroff",
  "init 0", "init 6", "init 1",
  "iptables -F", "ufw disable",
];

function isBlocked(command: string): string | null {
  const lower = command.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (lower.includes(blocked.toLowerCase())) {
      return `Command blocked for security: contains "${blocked}"`;
    }
  }
  return null;
}

function isPathWithinRoot(target: string, root: string): boolean {
  const resolved = path.resolve(target);
  const normalizedRoot = path.resolve(root);
  return resolved.startsWith(normalizedRoot + path.sep) || resolved === normalizedRoot;
}

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command in the project workspace. Returns stdout, stderr, and exit code.",
  parameters: z.object({
    command: z.string().min(1, "Command is required"),
    description: z.string().optional(),
    timeout: z.number().int().positive().optional().default(30000),
    workdir: z.string().optional(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { command, description, timeout, workdir } = args as {
      command: string;
      description?: string;
      timeout?: number;
      workdir?: string;
    };

    const blockedReason = isBlocked(command);
    if (blockedReason) {
      return {
        error: blockedReason,
        command,
        exitCode: -1,
        stdout: "",
        stderr: "",
      };
    }

    const root = process.cwd();
    const cwd = workdir ? path.resolve(root, workdir) : root;

    if (workdir && !isPathWithinRoot(cwd, root)) {
      return {
        error: `Access denied: working directory "${workdir}" is outside the project workspace`,
        exitCode: -1,
        stdout: "",
        stderr: "",
      };
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const isWindows = process.platform === "win32";

      const shell = isWindows ? "powershell" : "bash";
      const shellArgs = isWindows ? ["-Command", command] : ["-c", command];

      const proc = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timeoutId = setTimeout(() => {
        proc.kill("SIGTERM");
      }, timeout);

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (exitCode) => {
        clearTimeout(timeoutId);
        const effectiveTimeout = timeout ?? 30000;
      const duration = Date.now() - startTime;

        resolve({
          command,
          description: description || undefined,
          exitCode: exitCode ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
          timedOut: duration >= effectiveTimeout,
        });
      });

      proc.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          command,
          error: error.message,
          exitCode: -1,
          stdout: "",
          stderr: error.message,
        });
      });
    });
  },
};
