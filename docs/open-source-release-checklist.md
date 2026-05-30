# Open Source Release Checklist

This checklist keeps the public portfolio version separate from private local
research material. It is intentionally small: the goal is a safe, readable
agent-internship showcase, not a heavyweight release process.

## 1. Stage Only The Public Surface

Use explicit paths instead of `git add .`.

Recommended first public set:

```bash
git add \
  .gitignore \
  LICENSE \
  README.md \
  README.zh-CN.md \
  docs/toukeagent-readme-architecture.svg \
  docs/toukeagent-main-architecture.md \
  docs/toukeagent-main-architecture.svg \
  docs/development-playbook.md \
  docs/engineering-manual.md \
  docs/framework-next-steps.md \
  docs/knowledge-corpus-playbook.md \
  docs/open-source-release-checklist.md \
  data/wiki/notes/README.md \
  data/wiki/notes/demo \
  data/wiki/notes/project \
  data/wiki/notes/trigma
```

Add source, tests, scripts, configs, contracts, and OpenSpec paths explicitly as
needed. Keep long-form local iteration journals and generated planning artifacts
private until they have been cleaned for public paths and private-note mentions.
Do not stage local private notes or heavyweight runtime artifacts.

## 2. Keep These Local

These paths are excluded from the intended public surface:

```text
.env
.env.*
config/*.local.json
LLM wiki/
resume/
data/runtime/
data/models/
data/qdrant/
data/evals/
data/iteration_logs/
data/wiki/audits/
data/papers/raw/
data/papers/cache/
data/papers/normalized/
data/papers/chunks/
data/papers/builds/
data/papers/benchmarks/
```

## 3. Verify Before Publishing

Run the light checks first:

```bash
python3 -m toukeagent_core --action create_plan --payload '{}'
npm run test:contracts
node --check apps/platform/server.mjs
node --check apps/platform/public/app.mjs
python3 scripts/runtime_doctor.py
```

If `runtime_doctor.py` reports the server is unreachable, run `npm run dev` in a
separate terminal and retry. The full `npm test` suite is useful, but it is
heavier and may include known work-in-progress assertions. At the time of this
portfolio cleanup, `npm run test:server` is useful for investigation but not a
green release gate yet.

## 4. Review The Public Diff

Before pushing:

```bash
git diff --cached --stat
git diff --cached --name-only
git diff --cached
```

Look specifically for real keys, personal notes, resumes, model caches, local
database files, paper corpora, and generated benchmark artifacts.

## 5. Suggested Repository Framing

Good short description:

```text
Agent platform portfolio prototype with Plan-to-Act, micro-ReAct, hybrid
knowledge routing, memory, evaluation harnesses, and human-in-the-loop control.
```

Recommended topics:

```text
agents, llm, rag, memory, evaluation, agent-platform, openspec, nodejs, python
```
