import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

export function createReviewStore() {
  const records = new Map();

  function create(input = {}) {
    const now = new Date().toISOString();
    const review = {
      review_id: input.review_id ?? `review_${randomUUID()}`,
      queue_name: input.queue_name ?? 'quality',
      task_id: input.task_id ?? null,
      trace_id: input.trace_id ?? input.task_id ?? null,
      evaluation_id: input.evaluation_id ?? null,
      gate_id: input.gate_id ?? null,
      gate_status: input.gate_status ?? 'review_required',
      review_status: input.review_status ?? 'pending',
      reason: input.reason ?? 'manual_review',
      priority: input.priority ?? 'medium',
      sampled: Boolean(input.sampled),
      summary: input.summary ?? null,
      recommended_actions: clone(input.recommended_actions ?? []),
      metadata: clone(input.metadata ?? {}),
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
      resolved_at: input.resolved_at ?? null,
      resolution: clone(input.resolution ?? null),
    };

    records.set(review.review_id, review);
    return clone(review);
  }

  function get(reviewId) {
    const review = records.get(reviewId);
    return review ? clone(review) : null;
  }

  function list({ taskId = null, status = null, queueName = null } = {}) {
    return Array.from(records.values())
      .filter((review) => (taskId ? review.task_id === taskId : true))
      .filter((review) => (status ? review.review_status === status : true))
      .filter((review) => (queueName ? review.queue_name === queueName : true))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((review) => clone(review));
  }

  function resolve(reviewId, {
    decision,
    reviewer_id = 'system',
    notes = null,
    metadata = {},
  } = {}) {
    const current = records.get(reviewId);
    if (!current) {
      throw new Error(`Unknown review item: ${reviewId}`);
    }

    const now = new Date().toISOString();
    const updated = {
      ...current,
      review_status: decision ?? current.review_status,
      updated_at: now,
      resolved_at: now,
      resolution: {
        decision: decision ?? current.review_status,
        reviewer_id,
        notes,
        metadata: clone(metadata),
        resolved_at: now,
      },
    };
    records.set(reviewId, updated);
    return clone(updated);
  }

  return {
    create,
    get,
    list,
    resolve,
  };
}
