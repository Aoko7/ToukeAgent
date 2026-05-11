# Codex Workflow: OpenSpec + Superpowers + gstack-style Delivery

This repository follows a three-layer workflow:

1. OpenSpec: requirement and design alignment
2. Superpowers: implementation planning and execution
3. gstack-style delivery: verification, QA, review, and release gating

In Codex, `gstack` is treated as a delivery discipline rather than a literal tool name. Its equivalent here is:
- Browser-based visual verification
- local test and QA execution
- git-managed review and change delivery
- optional deploy or canary steps when the user explicitly asks for them

## Core Principles

1. Spec first: any feature, architectural change, or cross-module behavior change must start in OpenSpec.
2. `tasks.md` is the execution queue for implementation work.
3. If implementation reveals a spec gap, update OpenSpec first, then continue coding.
4. No completion claim without evidence: tests, screenshots, QA notes, or explicit verification output.
5. Git is the change-management backbone for the entire development flow.
6. Prefer the shortest valid path: do not expand into a heavier workflow when a smaller verified path is enough.

## Stage 1: OpenSpec

Before coding, the active change should define:

- `proposal.md`: why this change exists, goals, non-goals, success criteria
- `design.md`: architecture, data flow, interfaces, tradeoffs
- `contracts.md`: schemas and interface contracts when needed
- `tasks.md`: implementation breakdown
- `specs/**/spec.md`: acceptance requirements and scenarios

Required reading order:

1. `openspec/changes/<change-name>/proposal.md`
2. `openspec/changes/<change-name>/README.md`
3. `openspec/changes/<change-name>/design.md`
4. `openspec/changes/<change-name>/contracts.md`
5. `openspec/changes/<change-name>/tasks.md`
6. `openspec/changes/<change-name>/specs/**/spec.md`

If the work is not covered by an active change, create or update the OpenSpec package first.

## Stage 2: Superpowers

Implementation follows the active `tasks.md`.

### Superpowers execution loop

1. Read the next task slice from `tasks.md`.
2. Clarify ambiguity before coding when the ambiguity changes interfaces, scope, or risk.
3. Break work into small slices whenever possible.
4. Prefer test-first when behavior changes or contracts are introduced.
5. Implement one slice at a time.
6. Verify each slice before moving on.
7. Record the result in git.

### Preferred skill mapping

Use the available Codex superpowers-style skills as the default execution model:

- planning: `writing-plans`
- implementation: `executing-plans`
- test-first work: `test-driven-development`
- debugging: `systematic-debugging`
- pre-finish checks: `verification-before-completion`
- branch cleanup and closeout: `finishing-a-development-branch`
- worktree setup when helpful: `using-git-worktrees`

### Task sizing guidance

- Read-only work:
  inspect, explain, review, or trace behavior without editing

- Light task:
  single-file or tightly scoped change with obvious impact

- Medium task:
  multi-file feature slice or bounded refactor

- Large task:
  cross-module change, new public contract, new subsystem, or workflow rewrite

Large tasks should go through the full OpenSpec -> Superpowers -> delivery loop.

### TDD expectation

When behavior changes, prefer:

1. add or update test
2. implement behavior
3. refactor if needed
4. rerun verification

### Subagent strategy

Subagents are allowed only when:

- the user explicitly asks for delegation, parallel work, or subagents
- tasks are isolated and can run without shared mutable context

Do not use subagents when:

- tasks have strict ordering dependencies
- multiple tasks edit the same contract, schema, root config, lockfile, or shared entrypoint
- the task is a single bug fix or a tightly coupled debugging path

## Stage 3: gstack-style Delivery

This stage is the validation and handoff layer.

### Required gates

Before declaring work complete:

1. run relevant tests
2. verify user-facing flows
3. inspect the git diff
4. confirm alignment with OpenSpec
5. summarize what was verified and what was not

### Browser and UI verification

For frontend or local web changes:

- use the Browser plugin for localhost, file URLs, screenshots, and interaction checks
- capture visual evidence when appearance or rendering matters
- do not treat UI work as done without browser verification

### QA expectation

When a task touches a workflow rather than a single function:

- run the narrowest meaningful end-to-end check
- validate the core path, not just unit behavior
- report the actual result, not an assumption

### Ship and deploy discipline

- do not merge, ship, or deploy implicitly
- release steps happen only when the user asks for them
- canary, deploy, or production verification require explicit user direction

## Git Rules

- Work inside a git repository.
- If the repository is not initialized, run `git init` before the first implementation commit.
- Check `git status` before and after each task slice.
- Keep changes small and commit in logical units.
- Prefer clear commit boundaries over one giant feature commit.
- Do not discard user changes, rewrite history, or reset hard unless explicitly asked.
- Prefer the current branch unless the user requests a branch or worktree workflow.
- For larger feature work, consider isolated worktrees or clearly scoped branches.

## Security Guardrails

- Never hardcode secrets, tokens, or API keys.
- Do not log sensitive values into prompts, logs, or snapshots.
- Avoid destructive commands unless explicitly requested.
- Treat high-risk operations as approval points.
- Use parameterized or structured access patterns instead of unsafe command or query construction.

## Validation Gate

A change is only complete when:

- relevant verification has run
- the results are reported honestly
- any unrun checks are explicitly called out
- the diff is understood
- the work matches the active OpenSpec
- the resulting change is committed or intentionally left uncommitted with a reason

## Codex Tooling Rules

- Use `apply_patch` for direct file edits.
- Use shell commands for inspection, tests, and git operations.
- Use Browser for interactive local verification.
- Keep OpenSpec as the source of truth for scope.
- Keep git as the source of truth for implemented change history.

## Practical Boundary Summary

- OpenSpec defines what and why.
- Superpowers defines how to execute.
- gstack-style delivery defines how to prove it works.
- Git records every meaningful step of the change.
