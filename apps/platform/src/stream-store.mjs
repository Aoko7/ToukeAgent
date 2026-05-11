export function createStreamStore() {
  const buckets = new Map();

  function ensureBucket(taskId) {
    if (!buckets.has(taskId)) {
      buckets.set(taskId, {
        nextSeq: 1,
        events: [],
        subscribers: new Set(),
      });
    }
    return buckets.get(taskId);
  }

  function append(taskId, event) {
    const bucket = ensureBucket(taskId);
    const stored = {
      ...event,
      seq: Number.isFinite(event.seq) && event.seq > 0 ? event.seq : bucket.nextSeq++,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    bucket.events.push(stored);
    for (const subscriber of bucket.subscribers) {
      subscriber(stored);
    }
    return stored;
  }

  function replay(taskId, afterSeq = 0) {
    const bucket = ensureBucket(taskId);
    return bucket.events.filter((event) => event.seq > afterSeq);
  }

  function subscribe(taskId, handler) {
    const bucket = ensureBucket(taskId);
    bucket.subscribers.add(handler);
    return () => bucket.subscribers.delete(handler);
  }

  function snapshot(taskId) {
    return ensureBucket(taskId).events.slice();
  }

  return { append, replay, subscribe, snapshot };
}
