import { asArray, asNumber, asObject, asOptionalString, asString, clone } from './_shared.mjs';

const RUN_STATUS = new Set(['queued', 'planning', 'running', 'waiting_approval', 'resuming', 'taken_over', 'completed', 'failed', 'cancelled']);

export function createStepResult(input) {
  const result = asObject(input, 'step result');
  return {
    step_id: asString(result.step_id, 'step_id'),
    status: asString(result.status, 'status'),
    summary: asOptionalString(result.summary, 'summary'),
    output: result.output === undefined ? null : clone(result.output),
    error: result.error === undefined ? null : clone(result.error),
  };
}

export function createAgentRunState(input) {
  const state = asObject(input, 'agent run state');
  const status = asString(state.status ?? 'queued', 'status');
  if (!RUN_STATUS.has(status)) {
    throw new TypeError(`status must be one of ${Array.from(RUN_STATUS).join(', ')}`);
  }

  return {
    run_id: asString(state.run_id, 'run_id'),
    task_id: asString(state.task_id, 'task_id'),
    trace_id: asString(state.trace_id, 'trace_id'),
    persona_id: asString(state.persona_id, 'persona_id'),
    plan_id: asOptionalString(state.plan_id, 'plan_id'),
    status,
    current_step_id: asOptionalString(state.current_step_id, 'current_step_id'),
    completed_steps: asNumber(state.completed_steps, 'completed_steps', 0),
    total_steps: asNumber(state.total_steps, 'total_steps', 0),
    step_results: asArray(state.step_results, 'step_results', []).map(createStepResult),
    output: state.output === undefined ? null : clone(state.output),
    metadata: asObject(state.metadata, 'metadata', {}),
  };
}
