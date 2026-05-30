# ToukeAgent

> A portfolio-grade agent platform prototype built around `Plan-to-Act`, `micro-ReAct`, memory, RAG, wiki-style dynamic knowledge, evaluation harnesses, and human-in-the-loop governance.

[简体中文](./README.zh-CN.md) · [Architecture](./docs/toukeagent-main-architecture.md) · [Development Playbook](./docs/development-playbook.md) · [Engineering Manual](./docs/engineering-manual.md)

![ToukeAgent architecture](./docs/toukeagent-readme-architecture.svg)

## Why This Exists

ToukeAgent is my attempt to answer a practical question:

> If an agent is more than a chatbot, what should its platform skeleton look like?

This repository is not pretending to be a polished SaaS product. It is a learning-heavy, interview-facing engineering project for agent internships: a place where planning, retrieval, memory, streaming, quality gates, traces, and human takeover are wired into one coherent system. Some corners are still rough, but the skeleton is real. Think of it as a lab bench with labels, not a black box wearing a blazer.

## What It Demonstrates

- `Plan-to-Act + micro-ReAct`: task planning first, then small execution-oriented reasoning steps.
- `Node shell + Python core`: Node handles platform plumbing; Python handles agent decisions.
- Hybrid knowledge routing: stable RAG, dynamic wiki cards, and durable memory are treated as separate knowledge layers.
- Evaluation as a first-class workflow: generation, retrieval, memory, wiki, and knowledge harnesses produce reviewable artifacts.
- Human control surface: approval pauses, takeover, recovery, dead-letter handling, and trace replay are part of the runtime story.
- OpenSpec-driven development: requirements, contracts, tasks, and acceptance scenarios live beside the code.

## System Shape

ToukeAgent is split into three main layers:

| Layer | Responsibility | Representative files |
| --- | --- | --- |
| Node platform shell | HTTP API, SSE, browser console, stores, delivery, provider gateway, tool execution | `apps/platform/server.mjs`, `apps/platform/src/*.mjs` |
| Python agent core | Planning, retrieval routing, model routing, response drafting, quality gate decisions | `toukeagent_core/*.py` |
| Contracts and evidence | Cross-layer schemas, OpenSpec, tests, benchmarks, docs | `packages/contracts/`, `openspec/`, `tests/`, `docs/` |

The short version: Node keeps the platform alive; Python decides what the agent should do next; tests and traces keep both of them honest.

## Quick Start

Requirements:

- Node.js with the built-in `node:test` runner
- Python 3.11+
- Optional: a DeepSeek-compatible API key for live model calls

```bash
git clone <your-fork-or-repo-url>
cd ToukeAgent

cp config/model-config.example.json config/model-config.local.json
# Fill in config/model-config.local.json if you want remote model calls.

python3 -m toukeagent_core --action create_plan --payload '{}'
npm run test:contracts
node --check apps/platform/server.mjs
npm run dev
```

Then open the local platform:

```text
http://127.0.0.1:3000
```

For a local readiness check:

```bash
python3 scripts/runtime_doctor.py
```

If the doctor says the server is unreachable, start `npm run dev` first. It is a doctor, not a magician.

## Useful Commands

```bash
npm run dev
npm run doctor
npm run test:contracts
npm test
npm run smoke:live
npm run smoke:stream
npm run smoke:stream-reconnect
npm run smoke:approval
npm run smoke:restart
npm run smoke:wiki-first
npm run smoke:delivery
```

Use `npm run test:contracts`, `node --check apps/platform/server.mjs`, and the Python core command above for a quick public-readiness check. The broader `npm run test:server` and `npm test` suites currently include heavier integration and evaluation-style paths; at the time of this portfolio cleanup, `test:server` has two known work-in-progress assertions to revisit. For quick interviews, I usually show targeted tests plus one smoke script instead of making everyone watch a terminal meditate.

## Knowledge and Evaluation

ToukeAgent separates knowledge into three buckets:

- `RAG`: stable long-form material such as papers, engineering notes, and documentation.
- `Wiki`: compact dynamic cards for current project status, versions, decisions, and frequently changing facts.
- `Memory`: durable user or workspace facts, short-term session memory, compression snapshots, and handoff context.

Evaluation is also split by concern:

- Retrieval quality: `scripts/benchmark_retrieval_quality.py`
- Generation quality: `scripts/evaluate_generation_quality.py`
- Memory quality: `scripts/benchmark_memory_quality.py`
- Wiki quality: `scripts/evaluate_wiki_quality.py`
- Unified knowledge harness: `scripts/evaluate_knowledge_quality.py`

This is deliberately more process than demo. Agents fail quietly when evidence is missing; the harnesses make the failure louder and more useful.

## Repository Map

| Path | What to look for |
| --- | --- |
| `apps/platform/` | Node platform shell, server, SSE, browser console, stores, adapters |
| `toukeagent_core/` | Python planning, retrieval, memory policy, quality gate, orchestration |
| `packages/contracts/` | Cross-layer message, plan, stream, tool, delivery, and knowledge contracts |
| `tests/` | Unit, integration, harness, policy, runtime, and server tests |
| `scripts/` | Smoke tests, corpus tools, evaluation and benchmark runners |
| `openspec/` | Requirements, design notes, contracts, tasks, acceptance scenarios |
| `docs/` | Architecture notes, engineering manual, selected playbooks, release checklist |
| `data/wiki/notes/` | Small public sample wiki cards used for smoke and evaluation flows |

## Interview-Friendly Highlights

- I did not collapse everything into one giant prompt loop. The project has explicit runtime boundaries, contracts, and stores.
- I treated retrieval, memory, and dynamic wiki facts as different systems because they fail in different ways.
- I built evaluation harnesses early, so changes can be discussed with traces and metrics instead of vibes alone.
- I kept human approval and recovery in the main path, because agent systems should know how to stop before they confidently do the wrong thing.
- I used OpenSpec to record scope and tradeoffs, which makes the project easier to explain during code review or interviews.

## Current Limitations

- This is a portfolio prototype, not a production-ready managed service.
- Some tests are intentionally heavy because they exercise benchmark and harness paths.
- Local runtime data, model caches, private notes, resumes, and real API keys are excluded from the intended open-source surface.
- The frontend console is functional and inspectable, but the project is more about agent platform mechanics than pixel-perfect product polish.
- Some provider behavior depends on local configuration and available model credentials.

## Safety Notes Before Publishing

Before making a fork public, check that these stay untracked:

```text
.env
.env.*
config/*.local.json
data/runtime/
data/models/
data/qdrant/
data/papers/raw/
LLM wiki/
resume/
```

The public story should be code, contracts, docs, sample cards, and reproducible checks. Private notes can remain private. They have done enough unpaid labor already.

## Reading Order

If you are reviewing the project quickly:

1. Start with this README.
2. Read `docs/toukeagent-main-architecture.md` for the system picture.
3. Read `docs/development-playbook.md` for module boundaries and working style.
4. Skim `openspec/changes/add-plantoact-hybrid-memory-agent/README.md` for design intent.
5. Run `python3 -m toukeagent_core --action create_plan --payload '{}'` and one targeted `npm test` file.

## Status

ToukeAgent is currently best described as:

> an agent-platform engineering portfolio project, with enough moving parts to discuss real system design, and enough unfinished edges to still be honest.

That honesty is intentional. Agents are messy; the platform around them should at least admit it.
