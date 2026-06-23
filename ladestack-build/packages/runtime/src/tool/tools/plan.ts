import { z } from "zod";
import { ToolDefinition } from "../types.js";

interface PlanState {
  plan: string;
  steps: string[];
  completedSteps: number;
  stepStatuses: Array<{ step: string; status: "pending" | "in_progress" | "completed" | "failed" }>;
}

let currentPlan: PlanState | null = null;

export const planTool: ToolDefinition = {
  name: "plan",
  description: "Create, update, or retrieve an execution plan for complex multi-step tasks.",
  parameters: z.object({
    action: z.enum(["create", "update", "get"]),
    plan: z.string().optional(),
    steps: z.array(z.string()).optional(),
    stepIndex: z.number().int().nonnegative().optional(),
    stepStatus: z.enum(["pending", "in_progress", "completed", "failed"]).optional(),
  }),
  execute: async (args: Record<string, unknown>) => {
    const { action, plan, steps, stepIndex, stepStatus } = args as {
      action: "create" | "update" | "get";
      plan?: string;
      steps?: string[];
      stepIndex?: number;
      stepStatus?: "pending" | "in_progress" | "completed" | "failed";
    };

    switch (action) {
      case "create": {
        if (!plan || !steps || steps.length === 0) {
          return { error: "Plan and steps are required for create action" };
        }

        currentPlan = {
          plan,
          steps,
          completedSteps: 0,
          stepStatuses: steps.map((s) => ({ step: s, status: "pending" as const })),
        };

        return {
          action: "created",
          plan: currentPlan.plan,
          totalSteps: currentPlan.steps.length,
          steps: currentPlan.stepStatuses,
        };
      }

      case "update": {
        if (!currentPlan) {
          return { error: "No active plan. Create a plan first." };
        }

        if (!currentPlan) {
          return { error: "No active plan. Create a plan first." };
        }
        const planState = currentPlan;
        if (plan) planState.plan = plan;
        if (steps) {
          planState.steps = steps;
          planState.stepStatuses = steps.map((s, i) => ({
            step: s,
            status: planState.stepStatuses[i]?.status || ("pending" as const),
          }));
        }

        if (stepIndex !== undefined && stepStatus) {
          if (stepIndex >= 0 && stepIndex < planState.stepStatuses.length) {
            planState.stepStatuses[stepIndex]!.status = stepStatus;
            planState.completedSteps = planState.stepStatuses.filter(
              (s) => s.status === "completed"
            ).length;
          }
        }

        const allCompleted = planState.stepStatuses.every(
          (s) => s.status === "completed"
        );

        return {
          action: "updated",
          plan: planState.plan,
          totalSteps: planState.steps.length,
          completedSteps: planState.completedSteps,
          allCompleted,
          steps: planState.stepStatuses,
        };
      }

      case "get": {
        if (!currentPlan) {
          return { action: "get", hasPlan: false, message: "No active plan" };
        }

        const allCompleted = currentPlan.stepStatuses.every(
          (s) => s.status === "completed"
        );

        return {
          action: "get",
          hasPlan: true,
          plan: currentPlan.plan,
          totalSteps: currentPlan.steps.length,
          completedSteps: currentPlan.completedSteps,
          allCompleted,
          steps: currentPlan.stepStatuses,
        };
      }
    }
  },
};
