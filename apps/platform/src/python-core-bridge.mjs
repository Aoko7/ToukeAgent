import { spawnSync } from 'node:child_process';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function pythonExecutable() {
  return process.env.TOUKEAGENT_PYTHON ?? process.env.PYTHON ?? 'python3';
}

function buildEnv() {
  const pythonpath = [REPO_ROOT, process.env.PYTHONPATH].filter(Boolean).join(delimiter);
  return {
    ...process.env,
    PYTHONPATH: pythonpath,
  };
}

export function callPythonCore(action, payload = {}, metadata = {}) {
  const result = spawnSync(
    pythonExecutable(),
    ['-m', 'toukeagent_core'],
    {
      cwd: REPO_ROOT,
      env: buildEnv(),
      input: JSON.stringify({
        action,
        payload,
        metadata,
      }),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.stdout !== 'string' || result.stdout.trim().length === 0) {
    throw new Error(`Python core returned no output for action ${action}: ${result.stderr ?? 'empty stdout'}`);
  }

  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse Python core output for action ${action}: ${(error instanceof Error ? error.message : String(error))}\nstdout=${result.stdout}\nstderr=${result.stderr ?? ''}`);
  }

  if (!envelope?.ok) {
    const message = envelope?.error?.message ?? `Python core action ${action} failed`;
    const failure = new Error(message);
    failure.name = envelope?.error?.code ?? 'PythonCoreError';
    failure.details = envelope?.error?.details ?? {};
    throw failure;
  }

  return envelope.result;
}
