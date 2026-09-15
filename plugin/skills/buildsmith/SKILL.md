---
name: buildsmith
description: Drive a Buildsmith task from spec to verified feature. Loop `buildsmith step <id>` — it tells you whether to act yourself or dispatch a subagent. Use when the user wants a feature built through the Buildsmith pipeline, wants to resume a task on the board, or the repo has no Buildsmith board yet.
---

# Buildsmith

The board (`.buildsmith/`) holds all state and decides what happens next. You never decide the order of work; you run `buildsmith step` and do what it says. Requires the `buildsmith` command (inside this repo: `bun link` from the root).

## Start

- No `.buildsmith/` directory: run `buildsmith init`, then continue.
- New work: `buildsmith task create --id <slug> --title "<title>" --description "<what and why>"`, then `task update <id> --branch <branch>` once on a feature branch. Pick a short unique slug; it is the task id and the folder name. The spec is where criteria are written.
- Resuming: you only need the task id (a unique prefix works).

The first `step` is `write-project` until `.buildsmith/project.md` has real content. That step researches the repo (what it is, how to run, check, live-test, deploy, infra, logs, code conventions) and writes the file. Do not fill `project.md` by hand.

## Loop

Run `buildsmith step <id>` and act on `do`. Repeat until `done`.

| `do`       | What you do                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self`     | Follow `text`. It is written for you and says when to talk to the user and which commands to run at the end.                                                                                                                |
| `dispatch` | Spawn one generic subagent with model `model` and exactly `prompt` as its instructions. Add nothing. If `readonly` is true, it must not edit the repo — read-only tools only. If false, it may edit. When it returns, loop. |
| `ask`      | Show `text` to the user and stop; they decide how to continue.                                                                                                                                                              |
| `done`     | Summarize `buildsmith task get <id>` and stop.                                                                                                                                                                              |

If the user gives feedback on the spec or architecture at any point, record it — `buildsmith note add <id> --author user --target <spec|architecture> --verdict needs-changes` with their words on stdin — and loop; the board sends the doc back to you.

## Rules

- You are the planner: you write the spec and architecture (including its slices) with the user and rule on reviews of them. Approving the architecture creates the slices; `slice add` is only for fix slices after a failed verification. You never review your own doc, never write feature code, never polish the diff, never judge a diff, never research `project.md` yourself — those steps are always `dispatch`.
- Return lines from subagents are informational; the board is the truth.
- Never edit `.buildsmith/` by hand.
