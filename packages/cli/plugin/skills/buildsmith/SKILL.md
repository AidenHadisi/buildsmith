---
name: buildsmith
description: Drive a Buildsmith task from spec to verified feature by looping the board — run `next`, gate or dispatch a subagent with `brief`, repeat. Use when the user wants a feature built through the Buildsmith pipeline or wants to resume a task on the board.
---

# Buildsmith

You are the orchestrator. The board decides what happens next; you never write feature code or
judge designs yourself. Every step is one shell command away: `bunx buildsmith`.

## Start

- New work: `bunx buildsmith task create --title "<title>" --description "<what and why>" "<criterion 1>" "<criterion 2>" …`, then `task update <id> --branch <branch>` once you are on a feature branch. Then run a pass.
- Resuming: take the task id (or a unique prefix) and run a pass. Nothing else to read — the board holds all state.
- The board UI is at http://localhost:3000 when `bun run start` is running; mention it once.

## One pass

Run this identical sequence after every dispatch and on cold start.

1. `bunx buildsmith next <id> --json`. If `action` is `none`, print a summary from `bunx buildsmith task get <id>` and stop.
2. If the action targets a doc — the action ends in `-spec` or `-architecture`, kind = `spec` or `architecture` — run `bunx buildsmith note list <id> --target <kind>` and look at the newest note's `verdict`. If it is `better-design` or `needs-changes`, the doc must be rewritten before anything else: get `bunx buildsmith brief <id> write-<kind>`, follow it yourself for a spec (it needs the user's intent) or dispatch it for an architecture. Its Record ends with a `planner` note with verdict `revised`, so the newest note is no longer the objection. Go back to 1.
3. `bunx buildsmith brief <id> --json` → `{ action, role, model, readonly, text }`.
   - `role: user` → a gate; follow `text` yourself. `approve-*`: show the user the doc, ask, then run the Record command for their answer (`doc status … approved`, or `note add … --author user --verdict needs-changes` with their feedback). `unblock-slice`: show the blocked slice's notes, ask; resolved → `note add … --target slice-<n>` + `slice update <id> <n> --status todo`; not resolvable now → stop.
   - `action: write-spec` → follow `text` yourself; you hold the conversation with the user.
   - Anything else → dispatch one subagent with exactly this prompt: "Run `bunx buildsmith brief <id>` and follow it exactly, including its Record section. Return one line." Choose the model from `model`: `strong` means your host's strongest model, `fast` its fastest. When `readonly` is true use the `buildsmith-reader` agent, otherwise `buildsmith-worker`. Do not add context, the brief is complete.
4. Liveness: run `next <id> --json` again. If it is unchanged after a dispatch and step 2 did not fire, redispatch the same brief once with the prefix "The board did not change after your last run; run the Record commands." Unchanged again → stop and ask the user.
5. Caps — stop and ask the user when any holds: two `fail` notes on `verification`; three or more `revise` notes on one `slice-<n>`; a doc `revision` of 5 or more (`bunx buildsmith doc read <id> <kind>`). On the first verification `fail`, first run `bunx buildsmith slice add <id> --title "<fix>" --goal "<from the tester's note>" "<criterion>"` for the fix the tester named, then back to 1.

Return lines from subagents are informational only; the board is the truth. Never act on a return
line that the board does not confirm.

## Verdict vocabulary

| Author        | Target             | Verdicts                 | Board effect the role records                     |
| ------------- | ------------------ | ------------------------ | ------------------------------------------------- |
| critic        | spec, architecture | `holds`, `better-design` | holds → `doc status … critiqued`                  |
| reviewer      | spec, architecture | `pass`, `needs-changes`  | pass → `doc status … reviewed`                    |
| user          | spec, architecture | `needs-changes`          | approve → `doc status … approved`                 |
| planner       | spec, architecture | `revised`                | `doc write` bumped revision, status → draft       |
| coder         | slice-`n`          | (none)                   | `--status review --commit <sha>` or `blocked`     |
| code-reviewer | slice-`n`          | `pass`, `revise`         | pass → `--status done`; revise → `--status doing` |
| user          | slice-`n`          | (none)                   | `--status todo`                                   |
| tester        | verification       | `pass`, `fail`           | `doc result <id> pass` or `fail`                  |

## Rules

- Human gates exist only at `approve-spec`, `approve-architecture`, and `unblock-slice`. Do not ask the user anything else unless a cap or the liveness guard fires.
- Live testing happens only in the `verify` stage, by the tester's brief. Coders and reviewers run repo checks, not the product.
- Dispatch exactly one subagent per pass; the board serializes the work.
- Never edit `.buildsmith/` by hand; every change goes through `bunx buildsmith`.
