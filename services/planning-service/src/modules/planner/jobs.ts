import type { PlanContext, TaskInfo, generatePlan, simulateBusy } from '../sessions/rules.js';

/** Work the planning engine does off the main thread. Inputs are structured-cloned. */
export type PlannerJob =
  | { kind: 'generate'; ctx: PlanContext; tasks: TaskInfo[] }
  | {
      kind: 'simulate';
      ctx: PlanContext;
      busy: { date: string; startMinute: number; endMinute: number };
      tasks: Map<string, TaskInfo>;
    };
export type GenerateResult = ReturnType<typeof generatePlan>;
export type SimulateResult = ReturnType<typeof simulateBusy>;
