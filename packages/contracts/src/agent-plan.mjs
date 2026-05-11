import { asArray, asObject, asOptionalString, asString, clone } from './_shared.mjs';

const STEP_STATUS = new Set(['pending', 'running', 'completed', 'failed', 'cancelled']);

export function createPlanStep(input) {
  const step = asObject(input, 'plan step');
  const status = asString(step.status ?? 'pending', 'status');
  if (!STEP_STATUS.has(status)) {
    throw new TypeError(`status must be one of ${Array.from(STEP_STATUS).join(', ')}`);
  }

  return {
    step_id: asString(step.step_id, 'step_id'),
    title: asString(step.title, 'title'),
    objective: asString(step.objective ?? step.title, 'objective'),
    kind: asString(step.kind ?? 'reason', 'kind'),
    status,
    tool_name: asOptionalString(step.tool_name, 'tool_name'),
    acceptance: asArray(step.acceptance, 'acceptance', []).map((item) => asString(item, 'acceptance item')),
    metadata: asObject(step.metadata, 'metadata', {}),
  };
}

export function createAgentPlan(input) {
  const plan = asObject(input, 'agent plan');
  const steps = asArray(plan.steps, 'steps').map(createPlanStep);
  return {
    plan_id: asString(plan.plan_id, 'plan_id'),
    task_id: asString(plan.task_id, 'task_id'),
    trace_id: asString(plan.trace_id, 'trace_id'),
    persona_id: asString(plan.persona_id, 'persona_id'),
    goal: asString(plan.goal, 'goal'),
    summary: asString(plan.summary ?? plan.goal, 'summary'),
    steps,
    metadata: asObject(plan.metadata, 'metadata', {}),
  };
}

export function clonePlan(plan) {
  return clone(plan);
}
