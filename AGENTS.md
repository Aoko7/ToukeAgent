# Codex Repository Workflow

This repository is managed with three layers:

1. OpenSpec defines what to build.
2. Superpowers defines how to execute the work.
3. Git is the change-management backbone for every implementation step.

## Required Reading Order

Before coding, read the active OpenSpec change package:
- `openspec/changes/<change-name>/proposal.md`
- `openspec/changes/<change-name>/design.md`
- `openspec/changes/<change-name>/contracts.md`
- `openspec/changes/<change-name>/tasks.md`
- `openspec/changes/<change-name>/specs/**/spec.md`

If the work is not covered by an OpenSpec change, create or update the change first.

## Git Rules

- Work in a git repository.
- If the repository is not initialized, run `git init` before the first implementation commit.
- Check `git status` before and after each task slice.
- Keep changes small and commit in logical units.
- Do not rewrite user work, reset hard, or discard unowned changes.
- Prefer the current branch unless the user explicitly asks for branch work.
- A task is not finished until the relevant changes are committed or explicitly left staged with a reason.

## Superpowers Execution Model

Use the following loop for implementation:

1. Plan the task from `tasks.md`.
2. If needed, clarify ambiguous scope before coding.
3. Write or update tests first when behavior changes.
4. Implement in small slices.
5. Run verification after each meaningful slice.
6. Fix failures before moving on.
7. Record the result with git.

## Validation Gates

- Contract-first changes must update the relevant schema or interface files first.
- UI changes must be checked in the browser with screenshots or visual verification.
- Long task flows must be validated end to end.
- No delivery without tests, verification, and a reviewed diff.

## Codex Tooling

- Use the Browser plugin for localhost, file URLs, screenshots, and interactive verification.
- Use subagents only when the user asks for delegation or when tasks are clearly parallel and isolated.
- Use `apply_patch` for file edits.
- Use shell commands for inspection, tests, and git operations.

## OpenSpec + Execution Boundaries

- `proposal.md` explains why the change exists.
- `design.md` explains architecture and tradeoffs.
- `contracts.md` defines the actual schemas and interfaces.
- `tasks.md` is the execution queue.
- `spec.md` is the acceptance contract.

If implementation reveals a spec gap, update OpenSpec first, then continue.

## Delivery Definition

The work is only complete when:
- tests pass,
- required browser or QA checks are done,
- the git diff is understood,
- the change is committed,
- and the result matches the active OpenSpec.
