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

function attachWorkerStatusBridge({ eventBus, append, taskId, runId }) {
  if (!eventBus) {
    return () => {};
  }

  const mappings = [
    ['worker.job.queued', 'worker_queued', (job) => `Queued ${job.job_type}`],
    ['worker.job.started', 'worker_running', (job) => `Running ${job.job_type}`],
    ['worker.job.completed', 'worker_completed', (job) => `Completed ${job.job_type}`],
    ['worker.job.failed', 'worker_failed', (job) => `Failed ${job.job_type}: ${job.error?.message ?? 'unknown error'}`],
  ];

  const unsubscribes = mappings.map(([topic, state, messageFor]) => eventBus.subscribe(topic, (job) => {
    if (job.task_id !== taskId || job.run_id !== runId) {
      return;
    }

    append({
      event_type: 'status',
      step_id: job.step_id,
      payload: { state, message: messageFor(job) },
      metadata: {
        job_id: job.job_id,
        job_type: job.job_type,
        ...job.metadata,
      },
    });
  }));

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}

export async function runAgentTask({ message, persona, plan, toolRegistry, store, responseComposer, worker = null, eventBus = null, memoryStore = null, onTaskUpdate = null }) {
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

  const detachWorkerBridge = attachWorkerStatusBridge({
    eventBus,
    append,
    taskId: runState.task_id,
    runId: runState.run_id,
  });

  const emitTaskUpdate = (phase, summary, metadata = {}) => {
    onTaskUpdate?.({
      phase,
      summary,
      runState,
      metadata,
    });
  };

  try {
    append({
      event_type: 'start',
      payload: { title: 'Processing request', mode: 'assistant' },
    });
    emitTaskUpdate('start', 'Processing request started');

    append({
      event_type: 'status',
      payload: { state: 'planning', message: 'Plan created from the inbound request' },
    });
    emitTaskUpdate('planning', 'Plan created from the inbound request');

    append({
      event_type: 'delta',
      payload: { text: `Plan ready: ${buildPlanSummary(plan)}` },
    });

    runState.status = 'running';
    emitTaskUpdate('running', 'Execution started');

    let retrievalResult = null;
    for (const step of plan.steps) {
      runState.current_step_id = step.step_id;
      emitTaskUpdate('step_start', `Starting step: ${step.title}`, {
        step_id: step.step_id,
        step_title: step.title,
      });

      append({
        event_type: 'status',
        step_id: step.step_id,
        payload: { state: step.kind, message: `Running step: ${step.title}` },
      });

      if (step.kind === 'tool') {
        const callId = `call_${step.step_id}`;
        const request = {
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
        };

        append({
          event_type: 'tool_call',
          step_id: step.step_id,
          payload: {
            tool_name: step.tool_name,
            call_id: callId,
            summary: step.objective,
          },
        });

        retrievalResult = worker
          ? await worker.dispatch({
            job_type: 'tool.invoke',
            trace_id: runState.trace_id,
            task_id: runState.task_id,
            run_id: runState.run_id,
            step_id: step.step_id,
            persona_id: persona.persona_id,
            metadata: { tool_name: step.tool_name },
            payload: { request },
          })
          : await toolRegistry.invoke(request);

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

        const toolStepStatus = retrievalResult.status === 'success' ? 'completed' : 'failed';
        runState.step_results.push({
          step_id: step.step_id,
          status: toolStepStatus,
          summary: retrievalResult.summary,
          output: retrievalResult.result,
          error: retrievalResult.status === 'success'
            ? null
            : {
              code: retrievalResult.error_code ?? retrievalResult.status,
              message: retrievalResult.summary ?? 'Tool execution failed',
            },
        });
        emitTaskUpdate('tool_result', retrievalResult.summary ?? `Tool ${step.tool_name} completed`, {
          step_id: step.step_id,
          tool_name: step.tool_name,
          tool_status: retrievalResult.status,
        });
      } else if (step.kind === 'respond') {
        const memorySnapshot = memoryStore?.buildContext({
          taskId: runState.task_id,
          query: message.content.find((part) => part.type === 'text')?.text ?? plan.goal,
          limit: 4,
        }) ?? null;

        const finalText = worker
          ? (await worker.dispatch({
            job_type: 'response.compose',
            trace_id: runState.trace_id,
            task_id: runState.task_id,
            run_id: runState.run_id,
            step_id: step.step_id,
            persona_id: persona.persona_id,
            metadata: { persona_name: persona.name },
            payload: { persona, message, plan, retrievalResult, memorySnapshot },
          })).content
          : await responseComposer.compose({ persona, message, plan, retrievalResult, memorySnapshot });
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
        emitTaskUpdate('response', 'Final response composed', {
          step_id: step.step_id,
        });
      } else {
        runState.step_results.push({
          step_id: step.step_id,
          status: 'completed',
          summary: step.objective,
          output: { note: 'reasoning step complete' },
        });
        emitTaskUpdate('reasoning', step.objective, {
          step_id: step.step_id,
        });
      }

      runState.completed_steps += 1;
      emitTaskUpdate('step_completed', `Completed step: ${step.title}`, {
        step_id: step.step_id,
      });
    }

    runState.current_step_id = null;
    runState.status = 'completed';
    emitTaskUpdate('completed', 'Task completed');

    append({
      event_type: 'done',
      payload: { final_message_id: `out_${message.message_id}`, finish_reason: 'completed' },
      is_terminal: true,
    });

    return { runState, events };
  } finally {
    detachWorkerBridge();
  }
}
