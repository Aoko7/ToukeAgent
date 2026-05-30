import { callPythonCore } from './python-core-bridge.mjs';

export function buildPlanSummary(plan) {
  return callPythonCore(
    'build_plan_summary',
    { plan },
    { caller: 'apps/platform/src/runtime-policy.mjs' },
  );
}

export function prepareRuntimeStep(input) {
  return callPythonCore(
    'prepare_runtime_step',
    input,
    { caller: 'apps/platform/src/runtime-policy.mjs' },
  );
}
