---
name: buildsmith
description: Drive a Buildsmith task from spec to verified feature. Loop `buildsmith step <id>` — it tells you whether to act yourself or dispatch a subagent. Use when the user wants a feature built through the Buildsmith pipeline, wants to resume a task on the board, or the repo has no Buildsmith board yet.
---

# Buildsmith

Run `buildsmith step <id>`, do what it says, repeat. Buildsmith decides what comes next; you never pick the order of work.

Requires the `buildsmith` command. If it is missing, install it with `bun add -g buildsmith` (or `npm i -g buildsmith`). Inside the Buildsmith repo itself, run `bun link` from the root instead.

## Start

- **No `.buildsmith/`:** run `buildsmith init`, then continue.
- **Resuming a task:** you only need its id (a unique prefix works). Go to **Loop**.
- **New work:** follow the four steps below.

### 1. Explore

Dispatch read-only subagents in parallel: what exists today, where this would live, sibling features, conventions, constraints. Send researchers to the web when the request names something unfamiliar. Keep what they return; step 4 records it as findings so no later step has to look again.

### 2. Interview

Settle with the user what they want, why, and what is out of bounds. Prefer multiple-choice questions. Do not invent product decisions.

### 3. Write the description

It is pasted into every brief and is the one record of the user's intent that survives spec and architecture rewrites. In short paragraphs or bullets, cover:

- the problem and why it matters
- what the user asked for, in their words where possible
- constraints they stated
- references they pointed at (files, screens, links, examples)
- decisions made in conversation

No criteria, no design, and no repo facts; those belong to the spec, the architecture, and the findings.

### 4. Create

Pick a short unique slug; it is the task id and the folder name. Create `feat/<slug>` from the default branch unless you are already on a feature branch.

```sh
buildsmith task create --id <slug> --title "<title>" <<'EOF'
<the description>
EOF
git switch -c feat/<slug>
buildsmith task update <slug> --branch feat/<slug>
```

Then record what Explore found. Findings are facts about the repo — paths, current behavior, siblings, conventions, things checked and found absent — and every later brief carries them.

```sh
buildsmith note add <slug> --author planner --target findings <<'EOF'
- <fact, with the path or command that shows it>
EOF
```

The first `step` is `write-project` until `.buildsmith/project.md` has real content. That step researches the repo and writes the file; never fill it in by hand.

## Loop

Run `buildsmith step <id>` and act on `do`. Repeat until `done`.

| `do`       | What you do                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self`     | Follow `text`. It says when to talk to the user and which commands to run at the end.                                                                                                                                                 |
| `dispatch` | Spawn one generic subagent with exactly `prompt` as its instructions; add nothing. Set its model to `model` (`inherit` = leave unset). `readonly: true` means read-only tools only; `false` means it may edit. When it returns, loop. |
| `ask`      | Show `text` to the user and stop.                                                                                                                                                                                                     |
| `done`     | See **Finish**.                                                                                                                                                                                                                       |

**User feedback on a doc** at any point: record it and loop; the board sends the doc back to you.

```sh
buildsmith note add <id> --author user --target <spec|architecture> --verdict needs-changes <<'EOF'
<their words>
EOF
```

**After `run-verification` returns**, judge the proof before looping: read `buildsmith doc read <id> verification` and any screenshots under the task's `assets/`. A `Saw:` line that does not show the criterion (no status, no value, no screenshot for a page) is a failed proof. Record it and loop; the board sends the work back to the tester.

```sh
buildsmith doc result <id> fail
buildsmith note add <id> --author user --target verification --verdict fail <<'EOF'
<what is missing>
EOF
```

## Finish

1. `git push -u origin <branch>`
2. `gh pr create` on that branch. Body: what was built, then each spec criterion with its `Ran:` / `Saw:` evidence from the verification doc.
3. `buildsmith task update <id> --pr <url>`
4. Give the user the PR link and each criterion with its evidence, then stop.

## Rules

- **You are the planner.** You write the spec and architecture (with its slices) alongside the user and rule on their reviews. Approving the architecture creates the slices; `slice add` is only for fix slices after a failed verification.
- **You never** review your own doc, write feature code, polish the diff, judge a diff, or research `project.md` yourself. Those steps are always `dispatch`.
- **Protect your context.** Reading code, searching the repo, and researching go to read-only subagents, several in parallel when independent. Read a file yourself only when a ruling depends on its exact contents. Check the brief's Findings before dispatching, and record what readers return as findings.
- **The board is the truth.** Subagent return lines are informational. Never edit `.buildsmith/` by hand.
