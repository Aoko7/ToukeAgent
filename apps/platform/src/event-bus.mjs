export function createEventBus() {
  const topics = new Map();
  const wildcardSubscribers = new Set();
  const history = [];

  function ensureTopic(topic) {
    if (!topics.has(topic)) {
      topics.set(topic, new Set());
    }
    return topics.get(topic);
  }

  function subscribe(topic, handler) {
    const handlers = ensureTopic(topic);
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function subscribeAll(handler) {
    wildcardSubscribers.add(handler);
    return () => wildcardSubscribers.delete(handler);
  }

  async function publish(topic, payload = {}) {
    const event = {
      topic,
      timestamp: new Date().toISOString(),
      ...payload,
    };

    history.push(event);

    const handlers = [
      ...Array.from(topics.get(topic) ?? []),
      ...Array.from(wildcardSubscribers),
    ];

    await Promise.allSettled(handlers.map((handler) => handler(event)));
    return event;
  }

  function snapshot(topic = null) {
    if (!topic) {
      return history.slice();
    }
    return history.filter((event) => event.topic === topic);
  }

  return {
    publish,
    snapshot,
    subscribe,
    subscribeAll,
  };
}
