import { createAgentPlan } from '../../../packages/contracts/src/index.mjs';

function extractUserText(message) {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function summarizeGoal(text) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
}

export function createPlanner() {
  return {
    createPlan({ message, persona }) {
      const text = extractUserText(message) || 'Handle the inbound request';
      const stepPrefix = message.trace_id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const retrievalObjective = persona.retrieval_policy?.prefer_hybrid_rag
        ? 'Route retrieval across stable docs and dynamic wiki context'
        : 'Retrieve supporting context';

      return createAgentPlan({
        plan_id: `plan_${stepPrefix}`,
        task_id: message.trace_id,
        trace_id: message.trace_id,
        persona_id: persona.persona_id,
        goal: summarizeGoal(text),
        summary: `Plan the request, route context retrieval, then respond as ${persona.name}.`,
        steps: [
          {
            step_id: `${stepPrefix}_understand`,
            title: 'Understand request',
            objective: `Interpret the user request: ${summarizeGoal(text)}`,
            kind: 'reason',
            acceptance: ['Request intent is clear'],
          },
          {
            step_id: `${stepPrefix}_retrieve`,
            title: 'Route knowledge retrieval',
            objective: retrievalObjective,
            kind: 'tool',
            tool_name: 'hybrid_retrieve',
            acceptance: ['At least one relevant source is retrieved from the appropriate path'],
          },
          {
            step_id: `${stepPrefix}_respond`,
            title: 'Compose response',
            objective: 'Generate a concise, actionable response aligned with the active persona',
            kind: 'respond',
            acceptance: ['Response references the plan and retrieved context'],
          },
        ],
      });
    },
  };
}
