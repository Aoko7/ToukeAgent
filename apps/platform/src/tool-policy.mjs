import { callPythonCore } from './python-core-bridge.mjs';

export function buildToolPolicy(definition) {
  return callPythonCore(
    'build_tool_policy',
    { definition },
    { caller: 'apps/platform/src/tool-policy.mjs' },
  );
}

export function evaluateToolAttempt({ definition, policy, attempt, status, extra = {} }) {
  return callPythonCore(
    'evaluate_tool_attempt',
    {
      definition,
      policy,
      attempt,
      status,
      extra,
    },
    { caller: 'apps/platform/src/tool-policy.mjs' },
  );
}
