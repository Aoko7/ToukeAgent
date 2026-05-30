import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSQLiteWikiProvider } from './sqlite-wiki-provider.mjs';
import { createWikiStore } from './wiki-store.mjs';
import { createWikiRedisCache } from './wiki-redis-cache.mjs';

function resolveWikiFilePath(config = {}, env = process.env) {
  return config.sqlitePath
    ?? config.sqlite_path
    ?? env.TOUKEAGENT_WIKI_SQLITE_PATH
    ?? join(tmpdir(), 'toukeagent', 'wiki-store.sqlite');
}

export function createWikiSubsystem({
  config = {},
  env = process.env,
} = {}) {
  const sqlitePath = resolveWikiFilePath(config, env);
  const durableProvider = createSQLiteWikiProvider({ filePath: sqlitePath });
  const redisConfig = config.redis && typeof config.redis === 'object' ? config.redis : {};
  const cache = createWikiRedisCache({
    enabled: redisConfig.enabled ?? false,
    url: redisConfig.url ?? env.TOUKEAGENT_WIKI_REDIS_URL ?? null,
    keyPrefix: redisConfig.keyPrefix ?? redisConfig.key_prefix ?? 'toukeagent:wiki',
    ttlSeconds: Number(redisConfig.ttlSeconds ?? redisConfig.ttl_seconds ?? 60) || 60,
  });
  const wikiStore = createWikiStore({
    durableProvider,
  });

  function describeStrategy() {
    return {
      provider: 'sqlite',
      runtime_persistence: 'sqlite',
      durable_store: durableProvider.snapshot(),
      cache: cache.describe(),
    };
  }

  return {
    wikiStore,
    wikiDurableProvider: durableProvider,
    wikiCache: cache,
    wikiProviderStrategy: describeStrategy(),
    describeWikiStrategy: describeStrategy,
    wikiFilePath: sqlitePath,
  };
}
