import { callPythonCore } from './python-core-bridge.mjs';

export function createOutputEvaluator() {
  function evaluate({ message, persona, plan, runState }) {
    return callPythonCore(
      'evaluate',
      { message, persona, plan, runState },
      { caller: 'apps/platform/src/output-evaluator.mjs' },
    );
  }

  function evaluateBatch(items) {
    return items.map((item) => evaluate(item));
  }

  return {
    evaluate,
    evaluateBatch,
  };
}
