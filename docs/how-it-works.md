# How Buildsmith works

The whole system is a folder of markdown, one function that reads it, and prompts keyed by what that function returns. This page walks through each piece.

## The board on disk

```
.buildsmith/
  config.yml                  columns, model tiers
  project.md                  how to run / check / live-test; lessons learned
  prompts/                    optional per-repo prompt overrides
  tasks/<uuid>-<slug>/
    task.md                   title, column, order, branch, description, criteria
    spec.md                   status, revision + body
    architecture.md           status, revision + body
    slices/01-<slug>.md       status, commit + goal, criteria
    notes.md                  append-only log of verdicts
    verification.md           result + plan with Ran/Saw evidence
    assets/                   screenshots, fixtures
```

Every file is frontmatter + markdown. The store (`@buildsmith/store`) is the only thing that writes them: atomic writes, a per-task lock, YAML comments preserved. The CLI, the web board and the plugin all go through it.

## Statuses

| Thing        | Values                                       |
| ------------ | -------------------------------------------- |
| doc          | `draft → critiqued → reviewed → approved`    |
| slice        | `todo → doing → review → done`, or `blocked` |
| verification | no result → `pass` / `fail`                  |

Doc status only moves forward. Rewriting a spec or architecture (`doc write`) resets it to `draft` and bumps `revision`; that is what re-opens the critique loop after a change.

## `next()`: the due action

`next(task)` reads the files and returns the first unmet step. In order:

| Condition                                           | Action                                           |
| --------------------------------------------------- | ------------------------------------------------ |
| no spec                                             | `write-spec`                                     |
| newest spec note is `better-design`/`needs-changes` | `write-spec` (sent back)                         |
| spec `draft` / `critiqued` / `reviewed`             | `critique-spec` / `review-spec` / `approve-spec` |
| same four for architecture                          | `…-architecture`                                 |
| no slices                                           | `add-slice`                                      |
| a slice is `blocked`                                | `unblock-slice`                                  |
| a slice is `review`                                 | `review-slice`                                   |
| a slice is not `done`                               | `work-slice`                                     |
| no verification doc                                 | `write-verification`                             |
| verification not `pass`                             | `run-verification`                               |
| otherwise                                           | `none`                                           |

Because it is pure derivation, resuming from any state is just calling it again. There is nothing to "remember".

## Briefs: one template per action

`packages/cli/prompts/<action>.md` — fourteen files, one per action above. Frontmatter names the role, a model tier and whether the role is read-only:

```yaml
---
role: critic # planner | critic | reviewer | user | coder | code-reviewer | tester
model: strong # strong | fast, or a concrete model name
readonly: true
---
```

The body is markdown with slots that `buildsmith brief <id>` fills from the board:

| Slot                                                               | Content                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `{{id}}` `{{title}}` `{{description}}` `{{criteria}}` `{{branch}}` | the task                                                    |
| `{{project}}`                                                      | `project.md`                                                |
| `{{reason}}`                                                       | why this action is due, from `next()`                       |
| `{{doc}}` `{{revision}}`                                           | the spec for `*-spec`; the architecture for everything else |
| `{{slice}}`                                                        | the current slice: title, goal, criteria, commit            |
| `{{verification}}`                                                 | the verification doc (`run-verification`)                   |
| `{{notes}}`                                                        | notes on this action's target, oldest first                 |
| `{{cli}}`                                                          | how to invoke buildsmith from any directory                 |
| `{{extra}}`                                                        | `.buildsmith/prompts/<action>.extra.md`, if present         |

Each brief ends with a **Record** section: the exact commands the role runs to put its outcome on the board. That is the contract. A role that does its work but never records it has not changed the board, and `next()` returns the same action.

Override any template per repo: `buildsmith prompt eject <action>` copies it to `.buildsmith/prompts/<action>.md`; `prompt diff` shows your changes against the built-in.

## Notes: how roles talk to each other

`notes.md` is an append-only log. Each entry has an author, a target and optionally a verdict:

| Author        | Target                | Verdicts                  | Effect                                             |
| ------------- | --------------------- | ------------------------- | -------------------------------------------------- |
| critic        | `spec`/`architecture` | `holds` / `better-design` | holds → doc `critiqued`; better-design → sent back |
| planner       | `spec`/`architecture` | `revised`                 | Adopt/Reject rulings per critic point              |
| reviewer      | `spec`/`architecture` | `pass` / `needs-changes`  | pass → doc `reviewed`; needs-changes → sent back   |
| user          | `spec`/`architecture` | `needs-changes`           | sent back with your feedback                       |
| coder         | `slice-<n>`           | —                         | why a slice is blocked                             |
| code-reviewer | `slice-<n>`           | `pass` / `revise`         | pass → slice `done`; revise → slice `doing`        |
| tester        | `verification`        | `pass` / `fail`           | fail names the fix, added as a slice               |

The newest note on a doc decides whether it is "sent back". A planner's `revised` note closes the send-back, so the sequence is always critic → planner rulings → fresh critic, until `holds`.

## `step`: what the main agent runs

`buildsmith step <id>` wraps `next` + `brief` and adds the guardrails, so the orchestrating agent never branches on roles or counts revisions:

- `role: planner` or `user` → `{ do: "self", text }` — the main agent follows the brief itself (these are the steps that need you).
- any other role → `{ do: "dispatch", agent, model, prompt }` — `agent` is `buildsmith-reader` for read-only roles, else `buildsmith-worker`; `model` is the tier resolved through `config.yml`; `prompt` is one sentence: run `brief` and follow it.
- caps → `{ do: "ask", text }` — doc revision ≥ 5, three `revise` notes on one slice, two `fail` verifications, or the board unchanged after two dispatches of the same action (tracked in `.step.json` inside the task folder).
- `none` → `{ do: "done" }`.

The skill that ships in the plugin is a loop over these four cases and nothing else.

## The plugin

`packages/cli/plugin/` is installed by `buildsmith setup`:

- `skills/buildsmith/SKILL.md` — the loop.
- `agents/buildsmith-worker.md`, `agents/buildsmith-reader.md` — three-line shims: run the brief you were given, follow it, return one line. Cursor and Claude Code read these; Codex uses `codex/buildsmith-worker.toml`.
- Manifests for Cursor (`.cursor-plugin/`), Claude Code (`.claude-plugin/`) and Codex (`.codex-plugin/`), plus a marketplace file at the repo root.

`setup cursor` symlinks the plugin into `~/.cursor/plugins/local/`. `setup claude` and `setup codex` run the host's plugin commands when the CLI is on `PATH`, otherwise print them.

## Design choices, briefly

- **Prompts live in the CLI, not the plugin.** They are versioned with the state machine they describe, work on any host with a shell, and are overridable per repo.
- **Fresh subagent per step.** Cold eyes are the point of a critic. Each one sees the current revision and every prior ruling, and nothing else.
- **Roles record their own verdicts.** The orchestrator relays nothing, so nothing is lost in summary. Return lines are informational; the board is the truth.
- **Humans gate twice.** Approving the spec and the architecture is where product judgment lives. Everything else is agents holding each other to the approved documents.
- **Markdown over a database.** You can read the whole history in a diff, edit it in an emergency, and it needs no server.
