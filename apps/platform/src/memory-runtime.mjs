import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from './memory-store.mjs';
import { createMarkdownSessionMemoryArchive } from './markdown-session-memory-archive.mjs';
import { createPersistentMemoryProvider } from './persistent-memory-provider.mjs';
import { callPythonCore } from './python-core-bridge.mjs';

function resolveMemoryFilePath(config = {}, env = process.env) {
  return config.filePath
    ?? config.file_path
    ?? env.TOUKEAGENT_MEMORY_FILE
    ?? join(tmpdir(), 'toukeagent', 'memory-store.json');
}

function resolveSessionArchiveRoot(config = {}, env = process.env) {
  return config.sessionArchivePath
    ?? config.session_archive_path
    ?? env.TOUKEAGENT_SESSION_MEMORY_DIR
    ?? join(tmpdir(), 'toukeagent', `session-memory-${process.pid}`);
}

export function createMemorySubsystem({
  config = {},
  env = process.env,
} = {}) {
  const initialStrategy = callPythonCore('describe_memory_provider_strategy', {
    config,
  });
  const requestedProvider = initialStrategy.requested_provider ?? initialStrategy.provider ?? 'local_builtin';
  const requestedProviderConfig = initialStrategy.providers?.[requestedProvider] ?? null;
  const memoryFilePath = resolveMemoryFilePath(config, env);
  const sessionArchiveRoot = resolveSessionArchiveRoot(config, env);
  const shortTermArchive = createMarkdownSessionMemoryArchive({ rootDir: sessionArchiveRoot });

  let durableProvider = null;
  let runtime = {};
  if (requestedProvider === 'mem0_compatible') {
    if (requestedProviderConfig?.enabled === false) {
      runtime = {
        durable_backend_available: false,
        durable_backend_reason: 'provider_disabled',
      };
    } else if (requestedProviderConfig?.available === false) {
      runtime = {
        durable_backend_available: false,
        durable_backend_reason: 'provider_unavailable',
      };
    } else {
      try {
        durableProvider = createPersistentMemoryProvider({ filePath: memoryFilePath });
        runtime = {
          durable_backend_available: true,
          durable_backend_reason: null,
        };
      } catch (error) {
        runtime = {
          durable_backend_available: false,
          durable_backend_reason: error instanceof Error ? `durable_backend_init_failed:${error.message}` : 'durable_backend_init_failed',
        };
      }
    }
  }

  const strategy = callPythonCore('resolve_memory_provider_runtime', {
    config,
    runtime,
  });
  const effectiveDurableProvider = strategy.effective_provider === 'mem0_compatible' ? durableProvider : null;
  const memoryStore = createMemoryStore({
    providerStrategy: strategy,
    durableProvider: effectiveDurableProvider,
    shortTermArchive,
  });

  return {
    memoryStore,
    memoryProviderStrategy: strategy,
    durableMemoryProvider: effectiveDurableProvider,
    shortTermMemoryArchive: shortTermArchive,
    memoryFilePath,
    sessionArchiveRoot,
    runtime,
  };
}
