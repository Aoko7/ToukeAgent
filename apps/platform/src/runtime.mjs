import {
  createAgentRunState,
  createStreamEvent,
} from '../../../packages/contracts/src/index.mjs';

function createBaseEventContext({ message, persona, runState }) {
  return {
    trace_id: runState.trace_id,
    task_id: runState.task_id,
    run_id: runState.run_id,
    persona_id: persona.persona_id,
  };
}

function buildPlanSummary(plan) {
  return plan.steps
    .map((step, index) => `${index + 1}. ${step.title}`)
    .join(' | ');
}

function composeFinalText({ persona, message, plan, retrievalResult }) {
  const text = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  const sourceTitles = retrievalResult?.result?.items?.map((item) => item.title).join(', ') ?? 'internal stable context';
  return [
    `[${persona.name}]`,
    `Goal: ${plan.goal}`,
    `Plan: ${buildPlanSummary(plan)}`,
    `Stable context: ${sourceTitles}`,
    `Next move: start from the smallest verified slice for "${text}".`,
  ].join('\n');
}

export async function runAgentTask({ message, persona, plan, toolRegistry, store }) {
  const runState = createAgentRunState({
    run_id: `run_${message.trace_id}`,
    task_id: message.trace_id,
    trace_id: message.trace_id,
    persona_id: persona.persona_id,
    plan_id: plan.plan_id,
    status: 'planning',
    total_steps: plan.steps.length,
    step_results: [],
  });

  const events = [];
  const append = (eventInput) => {
    const event = createStreamEvent({
      ...createBaseEventContext({ message, persona, runState }),
      ...eventInput,
    });
    const stored = store.append(runState.task_id, event);
    events.push(stored);
    return stored;
  };

  append({
    event_type: 'start',
    payload: { title: 'Processing request', mode: 'assistant' },
  });

  append({
    event_type: 'status',
    payload: { state: 'planning', message: 'Plan created from the inbound request' },
  });

  append({
    event_type: 'delta',
    payload: { text: `Plan ready: ${buildPlanSummary(plan)}` },
  });

  runState.status = 'running';

  let retrievalResult = null;
  for (const step of plan.steps) {
    runState.current_step_id = step.step_id;

    append({
      event_type: 'status',
      step_id: step.step_id,
      payload: { state: step.kind, message: `Running step: ${step.title}` },
    });

    if (step.kind === 'tool') {
      const callId = `call_${step.step_id}`;
      append({
        event_type: 'tool_call',
        step_id: step.step_id,
        payload: {
          tool_name: step.tool_name,
          call_id: callId,
          summary: step.objective,
        },
      });

      retrievalResult = await toolRegistry.invoke({
        call_id: callId,
        tool_name: step.tool_name,
        trace_id: runState.trace_id,
        caller: {
          task_id: runState.task_id,
          step_id: step.step_id,
          persona_id: persona.persona_id,
        },
        arguments: {
          query: message.content.find((part) => part.type === 'text')?.text ?? plan.goal,
          persona_id: persona.persona_id,
        },
      });

      append({
        event_type: 'tool_result',
        step_id: step.step_id,
        payload: {
          call_id: retrievalResult.call_id,
          status: retrievalResult.status,
          summary: retrievalResult.summary,
        },
        usage: retrievalResult.metrics,
      });

      runState.step_results.push({
        step_id: step.step_id,
        status: 'completed',
        summary: retrievalResult.summary,
        output: retrievalResult.result,
      });
    } else if (step.kind === 'respond') {
      const finalText = composeFinalText({ persona, message, plan, retrievalResult });
      append({
        event_type: 'delta',
        step_id: step.step_id,
        payload: { text: finalText },
      });

      runState.output = {
        final_text: finalText,
      };
      runState.step_results.push({
        step_id: step.step_id,
        status: 'completed',
        summary: 'Response composed',
        output: runState.output,
      });
    } else {
      runState.step_results.push({
        step_id: step.step_id,
        status: 'completed',
        summary: step.objective,
        output: { note: 'reasoning step complete' },
      });
    }

    runState.completed_steps += 1;
  }

  runState.current_step_id = null;
  runState.status = 'completed';

  append({
    event_type: 'done',
    payload: { final_message_id: `out_${message.message_id}`, finish_reason: 'completed' },
    is_terminal: true,
  });

  return { runState, events };
}
