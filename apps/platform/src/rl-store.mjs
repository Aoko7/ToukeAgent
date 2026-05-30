import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function ensureBucket(map, taskId) {
  if (!map.has(taskId)) {
    map.set(taskId, []);
  }
  return map.get(taskId);
}

export function createRLStore() {
  const rewards = new Map();
  const policyLogs = new Map();
  const safetyGates = new Map();

  function appendReward(taskId, input = {}) {
    const bucket = ensureBucket(rewards, taskId);
    const record = {
      reward_id: input.reward_id ?? `reward_${randomUUID()}`,
      task_id: taskId,
      trace_id: input.trace_id ?? taskId,
      score: Number.isFinite(input.score) ? input.score : 0,
      signal: input.signal ?? 'quality',
      source: input.source ?? 'system',
      confidence: Number.isFinite(input.confidence) ? input.confidence : 0.5,
      metadata: clone(input.metadata ?? {}),
      created_at: input.created_at ?? new Date().toISOString(),
    };
    bucket.push(record);
    return clone(record);
  }

  function appendPolicyLog(taskId, input = {}) {
    const bucket = ensureBucket(policyLogs, taskId);
    const record = {
      policy_log_id: input.policy_log_id ?? `policy_${randomUUID()}`,
      task_id: taskId,
      trace_id: input.trace_id ?? taskId,
      policy_name: input.policy_name ?? 'default_agent_policy',
      policy_version: input.policy_version ?? 'v0',
      action: input.action ?? 'respond',
      decision: input.decision ?? 'pass',
      rationale: input.rationale ?? null,
      metadata: clone(input.metadata ?? {}),
      created_at: input.created_at ?? new Date().toISOString(),
    };
    bucket.push(record);
    return clone(record);
  }

  function appendSafetyGate(taskId, input = {}) {
    const bucket = ensureBucket(safetyGates, taskId);
    const record = {
      safety_gate_id: input.safety_gate_id ?? `safety_${randomUUID()}`,
      task_id: taskId,
      trace_id: input.trace_id ?? taskId,
      status: input.status ?? 'hold',
      allow_online_update: Boolean(input.allow_online_update),
      reward_eligible: input.reward_eligible ?? false,
      reason: input.reason ?? 'awaiting_evaluation',
      blocking_issues: clone(input.blocking_issues ?? []),
      metadata: clone(input.metadata ?? {}),
      created_at: input.created_at ?? new Date().toISOString(),
    };
    bucket.push(record);
    return clone(record);
  }

  function listRewards(taskId) {
    return clone(rewards.get(taskId) ?? []);
  }

  function listPolicyLogs(taskId) {
    return clone(policyLogs.get(taskId) ?? []);
  }

  function listSafetyGates(taskId) {
    return clone(safetyGates.get(taskId) ?? []);
  }

  function snapshot(taskId) {
    return {
      task_id: taskId,
      rewards: listRewards(taskId),
      policy_logs: listPolicyLogs(taskId),
      safety_gates: listSafetyGates(taskId),
      latest_reward: listRewards(taskId).at(-1) ?? null,
      latest_policy_log: listPolicyLogs(taskId).at(-1) ?? null,
      latest_safety_gate: listSafetyGates(taskId).at(-1) ?? null,
    };
  }

  return {
    appendReward,
    appendPolicyLog,
    appendSafetyGate,
    listRewards,
    listPolicyLogs,
    listSafetyGates,
    snapshot,
  };
}
