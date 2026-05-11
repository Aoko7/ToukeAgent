function clone(value) {
  return structuredClone(value);
}

export function createEvaluationStore() {
  const buckets = new Map();

  function ensure(taskId) {
    if (!buckets.has(taskId)) {
      buckets.set(taskId, []);
    }
    return buckets.get(taskId);
  }

  function append(taskId, entry) {
    const bucket = ensure(taskId);
    const stored = {
      ...clone(entry),
      task_id: taskId,
    };
    bucket.push(stored);
    return clone(stored);
  }

  function list(taskId) {
    return clone(ensure(taskId));
  }

  function getLatest(taskId) {
    const bucket = ensure(taskId);
    return bucket.length > 0 ? clone(bucket.at(-1)) : null;
  }

  return {
    append,
    list,
    getLatest,
  };
}
