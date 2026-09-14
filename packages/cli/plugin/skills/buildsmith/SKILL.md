---
name: buildsmith
description: Drive a Buildsmith task from spec to verified feature by looping the board — run `next`, then either do the step with the user or dispatch a subagent with `brief`. Use when the user wants a feature built through the Buildsmith pipeline or wants to resume a task on the board.
---

# Buildsmith

You are the orchestrator and the planner. You write the spec and architecture with the user and rule on critiques of them. Everything else — critique, review, code, testing — is done by fresh subagents that read their own brief. The board (`.buildsmith/`) holds all state; every step is one command: `bunx buildsmith`.

## Start

- New work: `bunx buildsmith task create --title "<title>" --description "<what and why>" "<criterion>" …`, then `task update <id> --branch <branch>` once on a feature branch.
- Resuming: take the task id (a unique prefix works). Read nothing else; the board is the state.
- The board UI is at http://localhost:3000 when `bun run start` is running; mention it once.

## The loop

Repeat until `next` says `none`:

1. `bunx buildsmith next <id> --json` → the due action. `none` → summarize `task get <id>` and stop.
2. `bunx buildsmith brief <id> --json` → `{ role, model, readonly, text }`.
3. `role: planner` or `role: user` → follow `text` yourself, with the user:
   - Planner briefs write or rewrite the spec/architecture. On a rewrite the brief carries the critic's note; rule Adopt or Reject on each point, ask the user when a point touches something they asked for, and record the rulings as the brief's Record says.
   - `approve-*`: show the doc; yes → the approve command; no → record their feedback as a user `needs-changes` note (the brief has the command).
   - `unblock-slice`: show the blocked slice's notes; resolved → the brief's Record commands; not now → stop.
4. Any other role → dispatch one subagent with exactly: "Run `bunx buildsmith brief <id>` and follow it exactly, including its Record section. Return one line." Use `buildsmith-reader` when `readonly` is true, else `buildsmith-worker`; `model: strong` is your host's strongest model, `fast` its fastest. Add nothing — the brief is complete.
5. Back to 1. Return lines are informational; the board is the truth.

The board enforces the pressure loop: a `better-design` or `needs-changes` note sends the doc back to you (`next` returns `write-<kind>`), your rewrite resets it to draft, and a fresh critic runs again. It only advances when a critic returns `holds`.

## Stop and ask the user when

- The board is unchanged after a dispatch. Redispatch once with the prefix "The board did not change after your last run; run the Record commands." Still unchanged → stop.
- A doc reaches revision 5 without holding; a slice collects three `revise` notes; verification fails twice. On the first verification `fail`, add a slice for the fix the tester named (`slice add`) and continue.
- The user gives feedback on a doc at any time: record it as `note add <id> --author user --target <kind> --verdict needs-changes` and continue the loop — it becomes a point you rule on.

## Rules

- Never critique or review your own doc; that is the critic's and reviewer's job.
- Never write feature code or judge a diff; that is the coder's and code-reviewer's job.
- Live testing happens only in the `verify` stage, by the tester's brief.
- One subagent per pass; never edit `.buildsmith/` by hand.
