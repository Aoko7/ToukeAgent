import { callPythonCore } from './python-core-bridge.mjs';

export function createQualityGate({
  sampleRate = 0,
} = {}) {
  return {
    evaluate(evaluation) {
      return callPythonCore('evaluate_quality_gate', {
        evaluation,
        sample_rate: sampleRate,
      });
    },
  };
}
