---
name: buildsmith
description: Drive a Buildsmith task from spec to verified feature. Loop `buildsmith step <id>` — it tells you whether to act yourself or dispatch a subagent. Use when the user wants a feature built through the Buildsmith pipeline or wants to resume a task on the board.
---

# Buildsmith

The board (`.buildsmith/`) holds all state and decides what happens next. You never decide the order of work; you run `buildsmith step` and do what it says. Requires the `buildsmith` command (inside this monorepo: `bun link` in `packages/cli`).

## Start

- New work: `buildsmith task create --title "<title>" --description "<what and why>" "<criterion>" …`, then `task update <id> --branch <branch>` once on a feature branch.
- Resuming: you only need the task id (a unique prefix works).

## Loop

Run `buildsmith step <id> --json` and act on `do`. Repeat until `done`.

| `do`       | What you do                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `self`     | Follow `text`. It is written for you and says when to talk to the user and which commands to run at the end.                        |
| `dispatch` | Spawn one subagent of type `agent` with model `model` and exactly `prompt` as its instructions. Add nothing. When it returns, loop. |
| `ask`      | Show `text` to the user and stop; they decide how to continue.                                                                      |
| `done`     | Summarize `buildsmith task get <id>` and stop.                                                                                      |

If the user gives feedback on the spec or architecture at any point, record it — `buildsmith note add <id> --author user --target <spec|architecture> --verdict needs-changes` with their words on stdin — and loop; the board sends the doc back to you.

## Rules

- You are the planner: you write the spec and architecture with the user and rule on critiques of them. You never critique or review your own doc, never write feature code, never judge a diff — those steps are always `dispatch`.
- Return lines from subagents are informational; the board is the truth.
- Never edit `.buildsmith/` by hand.
