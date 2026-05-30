import {
  createAgentRunState,
  createStreamEvent,
} from '../../../packages/contracts/src/index.mjs';
import { redactText } from './secret-manager.mjs';
import { buildPlanSummary, prepareRuntimeStep } from './runtime-policy.mjs';
import { callPythonCore } from './python-core-bridge.mjs';

function createBaseEventContext({ message, persona, runState }) {
  return {
    trace_id: runState.trace_id,
    task_id: runState.task_id,
    run_id: runState.run_id,
    persona_id: persona.persona_id,
  };
}

function findStepIndex(plan, stepId, fallback = 0) {
  if (!stepId) {
    return fallback;
  }

  const index = plan.steps.findIndex((step) => step.step_id === stepId);
  return index >= 0 ? index : fallback;
}

function createInitialRunState({ message, persona, plan, resumeState = null }) {
  if (resumeState) {
    const state = createAgentRunState({
      ...resumeState,
      status: 'running',
      total_steps: plan.steps.length,
      plan_id: plan.plan_id,
      task_id: message.trace_id,
      trace_id: message.trace_id,
      persona_id: persona.persona_id,
    });

    if (state.current_step_id) {
      state.step_results = state.step_results.filter((item) => item.step_id !== state.current_step_id);
    }

    return state;
  }

  return createAgentRunState({
    run_id: `run_${message.trace_id}`,
    task_id: message.trace_id,
    trace_id: message.trace_id,
    persona_id: persona.persona_id,
    plan_id: plan.plan_id,
    status: 'planning',
    total_steps: plan.steps.length,
    step_results: [],
  });
}

function attachWorkerStatusBridge({ eventBus, append, taskId, runId }) {
  if (!eventBus) {
    return () => {};
  }

  const mappings = [
    ['worker.job.queued', 'worker_queued', (job) => `Queued ${job.job_type}`],
    ['worker.job.started', 'worker_running', (job) => `Running ${job.job_type}`],
    ['worker.job.requeued', 'worker_requeued', (job) => `Requeued ${job.job_type} after failure`],
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

export async function runAgentTask({ message, persona, plan, toolRegistry, store, responseComposer, worker = null, eventBus = null, memoryStore = null, onTaskUpdate = null, resumeState = null, approvalContext = { approved: false }, orchestratorMode = 'legacy' }) {
  const runState = createInitialRunState({ message, persona, plan, resumeState });
  const startStepIndex = resumeState
    ? findStepIndex(plan, resumeState.current_step_id, Math.min(resumeState.completed_steps ?? 0, plan.steps.length))
    : 0;

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

  if (!resumeState && orchestratorMode === 'langgraph_mvp') {
    const graphRetrievalStep = plan.steps.find((step) => step.tool_name === 'hybrid_retrieve') ?? null;
    let graphRetrievalResult = null;
    if (graphRetrievalStep) {
      const retrievalDirective = prepareRuntimeStep({
        message,
        persona,
        plan,
        step: graphRetrievalStep,
        runState,
        approvalContext,
      });
      graphRetrievalResult = worker
        ? await worker.dispatch({
          job_type: 'tool.invoke',
          trace_id: runState.trace_id,
          task_id: runState.task_id,
          run_id: runState.run_id,
          step_id: graphRetrievalStep.step_id,
          persona_id: persona.persona_id,
          metadata: { tool_name: graphRetrievalStep.tool_name },
          payload: { request: retrievalDirective.tool_request },
          retry_limit: 2,
          dead_letter_on_failure: true,
          dead_letter_reason: 'worker_tool_failed',
        })
        : await toolRegistry.invoke(retrievalDirective.tool_request);
    }
    const memorySnapshot = memoryStore?.buildContext({
      taskId: runState.task_id,
      query: message.content?.find?.((part) => part.type === 'text')?.text ?? plan.goal,
      limit: 4,
    }) ?? null;
    const graphResult = callPythonCore(
      'run_orchestrator_graph',
      {
        message,
        persona,
        plan,
        orchestrator_mode: orchestratorMode,
        retrieval_result: graphRetrievalResult?.result ?? null,
        memory_snapshot: memorySnapshot,
      },
      { caller: 'apps/platform/src/runtime.mjs' },
    );
    append({
      event_type: 'start',
      payload: { title: 'Processing request', mode: 'assistant' },
    });
    for (const event of graphResult.node_events ?? []) {
      append({
        event_type: 'status',
        payload: {
          state: event.event_type,
          message: `${event.node_name}:${event.event_type}`,
        },
        metadata: {
          node_name: event.node_name,
          duration_ms: event.duration_ms ?? null,
          executor_backend: graphResult.executor_backend ?? null,
        },
      });
    }
    let composedResult = {
      content: graphResult.result?.answer ?? '',
      model_route: graphResult.draft?.model_route ?? null,
      fallback: graphResult.draft?.fallback ?? null,
    };
    if (responseComposer?.compose) {
      try {
        const composed = await responseComposer.compose({
          persona,
          message,
          plan,
          retrievalResult: graphResult.retrieval_result ?? null,
          memorySnapshot,
        });
        if (composed) {
          composedResult = typeof composed === 'string'
            ? { content: composed, model_route: null, fallback: null }
            : composed;
        }
      } catch {
        // Keep the graph-produced draft answer if provider composition is unavailable.
      }
    }
    const finalText = redactText(composedResult.content ?? graphResult.result?.answer ?? '');
    append({
      event_type: 'delta',
      payload: { text: finalText },
    });
    runState.status = 'completed';
    runState.current_step_id = null;
    runState.completed_steps = plan.steps.length;
    runState.output = {
      final_text: finalText,
      model_route: composedResult.model_route ?? graphResult.draft?.model_route ?? null,
      fallback: composedResult.fallback ?? graphResult.draft?.fallback ?? null,
      executor_backend: graphResult.executor_backend ?? null,
      orchestrator_mode: orchestratorMode,
    };
    runState.step_results.push({
      step_id: 'graph_orchestrator',
      status: 'completed',
      summary: 'Graph orchestrator completed',
      output: {
        executor_backend: graphResult.executor_backend ?? null,
        quality_gate: graphResult.quality_gate ?? null,
        retrieval: graphResult.retrieval_result?.filter_policy ?? null,
      },
    });
    append({
      event_type: 'done',
      payload: { final_message_id: `out_${message.message_id}`, finish_reason: 'completed' },
      is_terminal: true,
    });
    emitTaskUpdate('completed', 'Task completed through graph orchestrator', {
      orchestrator_mode: orchestratorMode,
      executor_backend: graphResult.executor_backend ?? null,
    });
    return { runState, events };
  }

  try {
    append({
      event_type: 'start',
      payload: { title: resumeState ? 'Resuming request' : 'Processing request', mode: 'assistant' },
    });
    emitTaskUpdate('start', resumeState ? 'Task resume started' : 'Processing request started');

    append({
      event_type: 'status',
      payload: { state: resumeState ? 'resuming' : 'planning', message: resumeState ? 'Resuming task from the latest recoverable checkpoint' : 'Plan created from the inbound request' },
    });
    emitTaskUpdate(resumeState ? 'resuming' : 'planning', resumeState ? 'Resuming task from the latest recoverable checkpoint' : 'Plan created from the inbound request');

    append({
      event_type: 'delta',
      payload: { text: `Plan ready: ${buildPlanSummary(plan)}` },
    });

    runState.status = 'running';
    emitTaskUpdate('running', resumeState ? 'Execution resumed' : 'Execution started');

    let retrievalResult = null;
    for (const step of plan.steps.slice(startStepIndex)) {
      runState.current_step_id = step.step_id;
      emitTaskUpdate('step_start', `Starting step: ${step.title}`, {
        step_id: step.step_id,
        step_title: step.title,
      });
      const stepDirective = prepareRuntimeStep({
        message,
        persona,
        plan,
        step,
        runState,
        approvalContext,
      });

      append({
        event_type: 'status',
        step_id: step.step_id,
        payload: { state: step.kind, message: stepDirective.status_message },
      });

      if (step.kind === 'tool') {
        const request = stepDirective.tool_request;

        append({
          event_type: 'tool_call',
          step_id: step.step_id,
          payload: stepDirective.tool_call_payload,
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
            retry_limit: 2,
            dead_letter_on_failure: true,
            dead_letter_reason: 'worker_tool_failed',
          })
          : await toolRegistry.invoke(request);

        append({
          event_type: 'tool_result',
          step_id: step.step_id,
          payload: {
            call_id: retrievalResult.call_id,
            tool_name: step.tool_name,
            status: retrievalResult.status,
            summary: retrievalResult.summary,
            error_code: retrievalResult.error_code ?? null,
          },
          usage: retrievalResult.metrics,
        });

        if (retrievalResult.status !== 'success' && retrievalResult.error_code === 'approval_required') {
          runState.step_results.push({
            step_id: step.step_id,
            status: 'waiting_approval',
            summary: retrievalResult.summary,
            output: {
              approval_required: true,
              tool_name: step.tool_name,
              call_id: retrievalResult.call_id,
            },
            error: {
              code: retrievalResult.error_code,
              message: retrievalResult.summary ?? 'Tool execution requires approval',
            },
          });
          runState.status = 'waiting_approval';
          append({
            event_type: 'status',
            step_id: step.step_id,
            payload: {
              state: 'waiting_approval',
              message: `Awaiting human approval for ${step.title}`,
            },
            metadata: {
              tool_name: step.tool_name,
              call_id: retrievalResult.call_id,
            },
          });
          emitTaskUpdate('waiting_approval', `Awaiting human approval for ${step.title}`, {
            step_id: step.step_id,
            step_title: step.title,
            tool_name: step.tool_name,
            approval_required: true,
            call_id: retrievalResult.call_id,
          });
          break;
        }

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
          query: stepDirective.memory_query,
          limit: 4,
        }) ?? null;

        const composeResult = worker
          ? await worker.dispatch({
            job_type: 'response.compose',
            trace_id: runState.trace_id,
            task_id: runState.task_id,
            run_id: runState.run_id,
            step_id: step.step_id,
            persona_id: persona.persona_id,
            metadata: { persona_name: persona.name },
            payload: { persona, message, plan, retrievalResult, memorySnapshot },
            retry_limit: 2,
            dead_letter_on_failure: true,
            dead_letter_reason: 'worker_compose_failed',
          })
          : await responseComposer.compose({ persona, message, plan, retrievalResult, memorySnapshot });
        const normalizedCompose = typeof composeResult === 'string'
          ? { content: composeResult, model_route: null, fallback: null }
          : composeResult;
        const rawFinalText = normalizedCompose.content ?? '';
        const finalText = redactText(rawFinalText);
        if (normalizedCompose.model_route) {
          append({
            event_type: 'status',
            step_id: step.step_id,
            payload: {
              state: 'model_routed',
              provider: normalizedCompose.model_route.provider,
              model: normalizedCompose.model_route.model,
              profile: normalizedCompose.model_route.profile,
              fallback_applied: normalizedCompose.fallback?.applied ?? false,
            },
            metadata: {
              reasoning_effort: normalizedCompose.model_route.reasoning_effort ?? null,
            },
          });
        }
        append({
          event_type: 'delta',
          step_id: step.step_id,
          payload: { text: finalText },
        });

        runState.output = {
          final_text: finalText,
          model_route: normalizedCompose.model_route ?? null,
          fallback: normalizedCompose.fallback ?? null,
        };
        runState.step_results.push({
          step_id: step.step_id,
          status: 'completed',
          summary: 'Response composed',
          output: runState.output,
        });
        emitTaskUpdate('response', 'Final response composed', {
          step_id: step.step_id,
          model_provider: normalizedCompose.model_route?.provider ?? null,
          model_name: normalizedCompose.model_route?.model ?? null,
          model_profile: normalizedCompose.model_route?.profile ?? null,
          model_reasoning_effort: normalizedCompose.model_route?.reasoning_effort ?? null,
          model_fallback_applied: normalizedCompose.fallback?.applied ?? false,
          model_fallback_reason: normalizedCompose.fallback?.reason ?? null,
        });
      } else {
        const reasonResult = stepDirective.reason_result ?? {
          summary: step.objective,
          output: { note: 'reasoning step complete' },
        };
        runState.step_results.push({
          step_id: step.step_id,
          status: 'completed',
          summary: reasonResult.summary,
          output: reasonResult.output,
        });
        emitTaskUpdate('reasoning', reasonResult.summary, {
          step_id: step.step_id,
        });
      }

      runState.completed_steps += 1;
      emitTaskUpdate('step_completed', `Completed step: ${step.title}`, {
        step_id: step.step_id,
      });
    }

    if (runState.status === 'waiting_approval') {
      return {
        runState,
        events,
        paused: true,
        pause_reason: 'approval_required',
        pause_step_id: runState.current_step_id,
      };
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

export async function resumeAgentTask(input) {
  return runAgentTask({
    ...input,
    resumeState: input.resumeState ?? input.runState ?? null,
  });
}
