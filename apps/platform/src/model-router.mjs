import { callPythonCore } from './python-core-bridge.mjs';

export function createModelRouter(config = {}) {
  const policy = callPythonCore(
    'build_model_policy',
    config,
    { caller: 'apps/platform/src/model-router.mjs' },
  );

  function getPolicy() {
    return structuredClone(policy);
  }

  function route({
    message = null,
    plan = null,
    memorySnapshot = null,
    retrievalResult = null,
  } = {}) {
    return callPythonCore(
      'route_model',
      {
        policy,
        message,
        plan,
        memorySnapshot,
        retrievalResult,
      },
      { caller: 'apps/platform/src/model-router.mjs' },
    );
  }

  return {
    getPolicy,
    route,
  };
}
