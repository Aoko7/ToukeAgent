import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

export function createWikiRedisCache({
  enabled = false,
  url = null,
  keyPrefix = 'toukeagent:wiki',
  ttlSeconds = 60,
} = {}) {
  let generation = randomUUID();
  let clientPromise = null;

  async function getClient() {
    if (!enabled || !url) {
      return null;
    }
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const { createClient } = await import('redis');
          const client = createClient({ url });
          client.on('error', () => {});
          await client.connect();
          return client;
        } catch {
          return null;
        }
      })();
    }
    return clientPromise;
  }

  function buildKey(scope, value) {
    return `${keyPrefix}:${generation}:${scope}:${value}`;
  }

  async function get(scope, value) {
    const client = await getClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(buildKey(scope, value));
    return raw ? JSON.parse(raw) : null;
  }

  async function set(scope, value, payload, overrideTtlSeconds = ttlSeconds) {
    const client = await getClient();
    if (!client) {
      return false;
    }
    await client.set(buildKey(scope, value), JSON.stringify(payload), {
      EX: overrideTtlSeconds,
    });
    return true;
  }

  function invalidate() {
    generation = randomUUID();
  }

  function describe() {
    return clone({
      enabled: Boolean(enabled && url),
      backend: enabled && url ? 'redis_optional' : 'disabled',
      key_prefix: keyPrefix,
      ttl_seconds: ttlSeconds,
    });
  }

  return {
    get,
    set,
    invalidate,
    describe,
  };
}
