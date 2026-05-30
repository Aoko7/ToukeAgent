import { createAgentPlan } from '../../../packages/contracts/src/index.mjs';
import { callPythonCore } from './python-core-bridge.mjs';

export function createPlanner() {
  return {
    createPlan({ message, persona }) {
      const plan = callPythonCore(
        'create_plan',
        { message, persona },
        { caller: 'apps/platform/src/planner.mjs' },
      );
      return createAgentPlan(plan);
    },
  };
}
