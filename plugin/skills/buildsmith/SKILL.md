---
name: buildsmith
description: Drive a Buildsmith task from spec to verified feature. Loop `buildsmith step <id>` — it tells you whether to act yourself or dispatch a subagent. Use when the user wants a feature built through the Buildsmith pipeline, wants to resume a task on the board, or the repo has no Buildsmith board yet.
---

# Buildsmith

The board (`.buildsmith/`) holds all state and decides what happens next. You never decide the order of work; you run `buildsmith step` and do what it says. Requires the `buildsmith` command (inside this repo: `bun link` from the root).

## Start

- No `.buildsmith/` directory: run `buildsmith init`, then continue.
- Resuming: you only need the task id (a unique prefix works).
- New work: understand it first, then create the task.

### Understand, then create

1. **Explore.** Dispatch read-only subagents in parallel to learn what the request touches: what exists today, where this would live, sibling features, conventions, constraints. Send a researcher to the web when the request names something unfamiliar.
2. **Interview.** Settle with the user what they want, why, and what is out of bounds — multiple-choice questions when possible. Do not invent product decisions.
3. **Write the description.** It is pasted into every brief and is the one record of the user's intent that survives spec and architecture rewrites. Cover, in short paragraphs or bullets: the problem and why it matters; what the user asked for, in their words where possible; constraints they stated; what you found in the repo that shapes the work (existing pieces, the area it lives in); references they pointed at (files, screens, links, examples); decisions made in conversation. No criteria and no design — those belong to the spec and the architecture.
4. **Create.** Pipe the description on stdin. Pick a short unique slug; it is the task id and the folder name. Create `feat/<slug>` from the default branch unless you are already on a feature branch, then record it.

   ```sh
   buildsmith task create --id <slug> --title "<title>" <<'EOF'
   <the description>
   EOF
   git switch -c feat/<slug>
   buildsmith task update <slug> --branch feat/<slug>
   ```

The first `step` is `write-project` until `.buildsmith/project.md` has real content. That step researches the repo (what it is, how to run, check, live-test, deploy, infra, logs, code conventions) and writes the file. Do not fill `project.md` by hand.

## Loop

Run `buildsmith step <id>` and act on `do`. Repeat until `done`.

| `do`       | What you do                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self`     | Follow `text`. It is written for you and says when to talk to the user and which commands to run at the end.                                                                                                                                                                                            |
| `dispatch` | Spawn one generic subagent with exactly `prompt` as its instructions. Add nothing. Set its model to `model`; if `model` is `inherit`, leave the model unset so it runs on yours. If `readonly` is true, it must not edit the repo — read-only tools only. If false, it may edit. When it returns, loop. |
| `ask`      | Show `text` to the user and stop; they decide how to continue.                                                                                                                                                                                                                                          |
| `done`     | Ship it: see **Finish** below.                                                                                                                                                                                                                                                                          |

If the user gives feedback on the spec or architecture at any point, record it — `buildsmith note add <id> --author user --target <spec|architecture> --verdict needs-changes` with their words on stdin — and loop; the board sends the doc back to you.

## Finish

When `run-verification` returns, judge the proof before looping: open `buildsmith doc read <id> verification` and any screenshots under the task's `assets/`. A `Saw:` line that does not show the criterion — no status, no value, no screenshot for a page — is a failed proof, not a pass. Record it — `buildsmith doc result <id> fail`, then `buildsmith note add <id> --author user --target verification --verdict fail` with what is missing on stdin — and loop; the board sends the work back to the tester.

On `done`:

1. **Push.** `git push -u origin <branch>`.
2. **Open the PR.** `gh pr create` on that branch. The body states what was built, then lists each spec criterion with its `Ran:` / `Saw:` evidence from `buildsmith doc read <id> verification`.
3. **Record it.** `buildsmith task update <id> --pr <url>`.
4. **Report.** Give the user the PR link and each criterion with its evidence, then stop.

## Rules

- You are the planner: you write the spec and architecture (including its slices) with the user and rule on reviews of them. Approving the architecture creates the slices; `slice add` is only for fix slices after a failed verification. You never review your own doc, never write feature code, never polish the diff, never judge a diff, never research `project.md` yourself — those steps are always `dispatch`.
- Protect your context. Reading code, searching the repo, and researching go to read-only subagents, several in parallel when the questions are independent. You read a file yourself only when a ruling depends on its exact contents.
- Return lines from subagents are informational; the board is the truth.
- Never edit `.buildsmith/` by hand.
