# Plugin

## What we're building

The store holds pipeline state, the CLI mirrors it, and the web board renders it — but nothing yet tells an agent _what to do_ at each step, and the craft plugin this grew out of keeps that knowledge in host-specific agent files and re-briefs it into the orchestrator's context on every dispatch. We are adding `buildsmith brief <id>`: the CLI renders the prompt for whatever `next()` says is due, from markdown templates shipped with the CLI and overridable per repo. A single orchestrator skill loops `next → gate or dispatch → next`; every subagent is told only "run `buildsmith brief <id>` and follow it" and records its result on the board through the CLI. The plugin (skill, thin shim agents, manifests for Cursor, Claude Code and Codex) lives inside the CLI package so `bunx buildsmith setup` can install it. Done means the seven criteria below are proven live, including a dogfood run where real subagents drive a task through critique, coding and slice review using only briefs.

## Requirements

- `doc write` on an existing spec/architecture resets `status` to `draft` and bumps `revision`, so a rewrite after critique or review re-enters the critique loop with a fresh revision.
- `next()` returns `review-slice` (stage `building`) for a slice in status `review`; `blocked` still wins.
- `brief <id>`: text = rendered template for `next(id).action`; `--json` = `{ action, role, model, readonly, text }`; `action: none` → "nothing to do", exit 0.
- Templates: one `prompts/<action>.md` per action with frontmatter `role`, `model` (`strong|fast`), `readonly`; body uses `{{var}}` slots; unknown slot → error.
- Overrides: `.buildsmith/prompts/<action>.md` replaces; `.buildsmith/prompts/<action>.extra.md` fills `{{extra}}`.
- `prompt list | show <action> | eject <action> | diff <action>`.
- Plugin: skill `buildsmith` (orchestrator), agents `buildsmith-worker` and `buildsmith-reader` (readonly), manifests for three hosts, root `.claude-plugin/marketplace.json`.
- `setup [hosts…] [--dry-run]`: Cursor symlink; Claude/Codex plugin CLI commands (run if the CLI exists, else print); Codex worker TOML.
- Human gates only at `approve-spec` and `approve-architecture`; live testing only in the `verify` stage.

## Out of scope

- npm publish — skills say `bunx buildsmith`; inside this repo that already resolves. Publishing is its own step.
- Hooks (`SessionStart` prime, shell allowlists) — follow-up once the loop is stable; event names differ per host.
- MCP server; web UI changes; changing the column model.
- Enforcing tool restrictions on subagents — Cursor has only `readonly`, Codex only sandbox; briefs carry the contract.
- Template partials / includes — one file per action; the duplication is small and readable.

## Acceptance criteria

Frozen on approval. A box is checked only with evidence from a live run. Writes against this repo's `.buildsmith/` are reverted with `git checkout -- .buildsmith`; pipeline runs use temp repos.

- [x] **Loop-ready store** — proof: `doc write` twice on a spec → second result `status: draft, revision: 2` (also after `critiqued`); `slice update <id> 1 --status review` → `next` = `review-slice`; the `next` walk test covers both.
- [x] **Brief** — proof: temp repo; `brief <id>` at `write-spec`, `critique-spec`, `review-spec`, `work-slice`, `review-slice`, `run-verification` each prints a brief naming the task title and the exact `buildsmith` commands the role must run; `--json` has `action, role, model, readonly, text`; at `done` prints `nothing to do`, exit 0.
- [x] **Customizable prompts** — proof: `prompt list` → every action `built-in`; `prompt eject critique-spec` writes `.buildsmith/prompts/critique-spec.md`; edit it → `brief` shows the edit, `list` shows `repo`, `diff` shows the edit; `critique-spec.extra.md` appears in the brief without eject; `show` prints the resolved text.
- [x] **Plugin package** — proof: `packages/cli/plugin/` has `skills/buildsmith/SKILL.md`, `agents/buildsmith-worker.md`, `agents/buildsmith-reader.md`, `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (with `"hooks": {}`); root `.claude-plugin/marketplace.json` points at `./packages/cli/plugin`; all JSON parses; frontmatter has each host's required fields; `agent --plugin-dir packages/cli/plugin` (Cursor CLI) lists the `buildsmith` skill or the symlink in `~/.cursor/plugins/local/` is present and the user sees the skill after reload.
- [x] **Setup** — proof: `setup --dry-run` prints the exact actions for cursor, claude and codex; `HOME=$(mktemp -d) setup cursor` creates `$HOME/.cursor/plugins/local/buildsmith` → plugin dir; `setup claude` / `setup codex` with no CLI on PATH print the commands and exit 0; `setup codex` writes `$HOME/.codex/agents/buildsmith-worker.toml`.
- [x] **Dogfood** — proof: temp repo with a task and a draft spec; a generic subagent told only "run `<cli> brief <id>` and follow it" leaves a `note` with a verdict for `critique-spec` and advances status only on Holds; the same instruction at `work-slice` implements a trivial slice and moves it to `review`; at `review-slice` it moves the slice to `done` (or back to `doing`) with a note. Board state checked after each via `task get`, `note list`, `slice list`.
- [x] **Green checks** — proof: `bun run check`, `bun run typecheck`, `bun test`, `bun run build`; README has a "Plugin" section.

## Architecture

### 0. Store — loop-ready transitions

`docs.write` for `spec|architecture`: if the doc exists, `{ status: "draft", revision: prev.revision + 1 }` regardless of prior status (today only when `approved`). `next()`: after the `blocked` check, `slices.find(s => s.status === "review")` → `{ stage: "building", action: "review-slice", reason: "slice N is in review" }` before the generic `work-slice` (so a slice in review preempts one in `doing`; test pins it). Two test additions in `store.test.ts`. Also export `splitFrontmatter` and `parseYaml` from `index.ts` for the CLI's template loader.

### 1. Prompt templates — `packages/cli/prompts/<action>.md`

One file per `next()` action: `write-spec`, `critique-spec`, `review-spec`, `approve-spec`, `write-architecture`, `critique-architecture`, `review-architecture`, `approve-architecture`, `add-slice` (adds every slice in one run — `next` only returns it while there are none), `work-slice`, `review-slice`, `unblock-slice` (`role: user`), `write-verification`, `run-verification`. Frontmatter: `role` (`planner|critic|reviewer|user|coder|code-reviewer|tester`), `model` (`strong|fast`), `readonly` (bool); validated in the CLI with `asEnum` / `=== true` since `parseYaml` does not throw. Body is markdown with `{{slot}}`s.

Slots (all filled by `brief`, unknown → `unknown slot {{x}} in <file>`): `id`, `title`, `description`, `criteria` (bulleted), `branch`, `project` (project.md), `reason` (from `next`), `revision`, `doc` (body of the doc this action targets: spec for `*-spec`, architecture for `*-architecture` **and** for every slice/verification action, since coder and tester build from it; `(none)` if absent), `slice` (`#n title — goal`, criteria, `commit`, for slice actions), `verification` (verification.md body or `(none)`, for `run-verification`), `notes` (notes whose `target` equals this action's target, newest last), `cli` (`bun ${Bun.main}` — always runnable from any cwd, however the CLI was launched), `extra` (`.buildsmith/prompts/<action>.extra.md` or empty). Every built-in template contains `{{extra}}`.

Note targets are a fixed vocabulary that the Record sections pin: `spec`, `architecture`, `slice-<n>`, `verification`; `notes.list(id, target)` is an exact match.

Each body ends with a **Record** section naming the exact `{{cli}}` commands for the role's outcomes, e.g. critic: `{{cli}} note add {{id}} --author critic --target spec --verdict holds|better-design < note.md`, and on Holds `{{cli}} doc status {{id}} spec critiqued`. Coder: `slice update … --status review --commit <sha>`. Code-reviewer: `--status done` or `--status doing` + note. Tester: `doc write … verification` then `doc result … pass|fail`. `approve-*` templates have `role: user` and tell the orchestrator to show the doc and wait.

Substance ported from craft (host-neutral): critic "Better design | Holds", alternatives always named; reviewer quotes + fix; coder least-code rules; code-reviewer line-cited findings, "empty Pass is valid"; tester Ran/Saw, nothing leaves the system, cleanup line. No host tool names or model names.

### 2. CLI — `brief`, `prompt`, `setup` (`packages/cli/src/`)

- `prompts.ts`: `resolve(store, action)` → `{ source: "repo" | "built-in", path }` (repo `.buildsmith/prompts/<action>.md` first, else `join(import.meta.dir, "../prompts", …)`); `load(path)` → `splitFrontmatter` + `parseYaml` **exported from the store's `files.ts`** (no `yaml` dep in the CLI) + body; `render(body, vars)` with `replaceAll(/\{\{(\w+)\}\}/g)`; `ACTIONS` from the built-in directory listing.
- `commands/brief.ts`: `brief <id> [action]` — `action` defaults to `next(store, id).action` (`none` → `nothing to do`); the optional positional lets the orchestrator render `write-spec`/`write-architecture` for a rewrite after `better-design`/`needs changes`, without a new command. Output: the rendered text is `console.log`ged directly unless `args.json` (declare `json: { type: "boolean" }` on the leaf; subagent shells are never TTYs, so `io.json` would otherwise turn every brief into an escaped JSON string); with `--json` returns `{ action, role, model, readonly, text }`. Same rule for `prompt show` and `prompt diff`.
- `commands/prompt.ts`: `list` → `[{ action, source }]`; `show <action>` → resolved raw text; `eject <action>` → copy built-in to `.buildsmith/prompts/` (error if exists); `diff <action>` → `Bun.spawn(["diff", "-u", builtIn, repo])` output (`diff` exit 1 = differs, not failure; no override → `no override for <action>`).
- `commands/setup.ts`: not store-backed (mirrors `init`). Hosts `cursor|claude|codex`, **default all three**; `Bun.which` decides run-vs-print only. Plugin dir = `join(import.meta.dir, "../../plugin")`. Cursor: `~/.cursor/plugins/local/buildsmith` — `lstat`: symlink → replace; real directory → throw; missing → `symlink(pluginDir, …)`. Claude: `claude plugin marketplace add AidenHadisi/buildsmith`, `claude plugin install buildsmith@buildsmith`. Codex: `codex plugin marketplace add AidenHadisi/buildsmith`, `codex plugin add buildsmith@buildsmith`, plus `copyFile(plugin/codex/buildsmith-worker.toml, ~/.codex/agents/buildsmith-worker.toml)` (static file, no TOML generation). Commands run via `Bun.spawn` when the binary exists, else printed under "run manually". `--dry-run` prints every action, does nothing. Returns `[{ host, action, status: done|printed|dry-run }]`.
- `main.ts`: register `brief`, `prompt`, `setup`.

### 3. Plugin package — `packages/cli/plugin/`

- `skills/buildsmith/SKILL.md` — the orchestrator. One board-driven pass, identical after every dispatch and on cold start:
  1. `bunx buildsmith next <id> --json`; `done` → summary from `task get`, stop.
  2. If the action targets `spec` or `architecture`: `note list <id> --target <kind>`; newest verdict `better-design` | `needs-changes` → rewrite: dispatch (spec: follow yourself) `brief <id> write-<kind>`; its Record ends with `note add … --author planner --verdict revised`, so the newest note becomes the writer's. Back to 1.
  3. `brief <id> --json`. `role: user` → gate. `approve-*`: show the doc, ask; yes → `doc status … approved`; no → `note add … --author user --target <kind> --verdict needs-changes` with the feedback. `unblock-slice`: show the blocked slices' notes, ask; resolved → `note add … --target slice-<n>` + `slice update <n> --status todo`; can't → stop. `write-spec` → follow the brief yourself. Anything else → dispatch a generic subagent: "run `bunx buildsmith brief <id>` and follow it; return one line" — `model` `strong|fast` means your host's strongest/fastest model; readonly shim when `readonly`.
  4. Liveness: if `next --json` is unchanged after a dispatch and step 2 did not fire, redispatch once with "the board did not change; run the Record commands"; unchanged again → stop and ask.
  5. Caps: two `fail` notes on `verification`, ≥3 `revise` notes on one `slice-<n>`, or doc `revision` ≥ 5 → stop and ask. First verification `fail` → `slice add` for the fix the tester named, back to 1.
     Return lines are informational only. Verdict vocabularies pinned per role: critic `holds|better-design`, reviewer `pass|needs-changes`, code-reviewer `pass|revise`, tester `pass|fail` (note on `verification` naming the fix), planner `revised`, user `needs-changes`. Coder Record includes the `blocked` path: `slice update <n> --status blocked` + note on `slice-<n>`. Says how to start: `task create`, board URL.
- `agents/buildsmith-worker.md`, `agents/buildsmith-reader.md` (readonly: true; Claude `tools: Bash, Read, Grep, Glob`); no fixed `model` (the skill passes one per dispatch). Bodies are three lines: run the brief command given, follow it exactly, return the one-line result. `codex/buildsmith-worker.toml` — the same three lines as a static Codex custom agent.
- Manifests: `.cursor-plugin/plugin.json` (`name`, `description`, `version`, `author`, `license`, `repository`), `.claude-plugin/plugin.json` (same + `skills`, `agents` default dirs), `.codex-plugin/plugin.json` (`name`, `version`, `description`, `skills: "./skills/"`, `hooks: {}`). Root `.claude-plugin/marketplace.json`: `{ name: "buildsmith", plugins: [{ name: "buildsmith", source: "./packages/cli/plugin", description }] }` — effective for real users only once `feat/plugin` is on `main`.

### Seams

store → cli (`next`, docs, slices, notes, project) → `brief` text → subagent → cli mutations → store. Templates → `brief` only. Plugin skill → shell only. `setup` → filesystem + host CLIs. Nothing imports the plugin dir at runtime except `setup` (path) and Codex TOML generation (reads the worker md).

### Key decisions

- Prompts live in the CLI, not the plugin: versioned with the state machine they describe; portable because every host has a shell; repo-overridable.
- Templates keyed by `next()` action: the customization surface equals the set of steps.
- Doc bodies inline via `{{doc}}`: the role needs them anyway; briefs stay bounded because slices/notes are filtered to the current target.
- `plugin/` inside `packages/cli` so a future npm publish ships it; root marketplace file points there.
- Skill holds the loop; briefs hold the roles. Moving the loop into a `brief` for a "main" role is a later option.

## Conventions

- ESM, `.ts` imports, `import type`, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`; plain `Error`s — exemplar: `packages/cli/src/io.ts`
- Commands: default-export `defineCommand` with `subCommands`; leaves `run: act(...)`; non-store commands mirror `commands/init.ts` — exemplar: `packages/cli/src/commands/doc.ts`
- Tests: `bun:test`, spawn `bun src/main.ts` via `run()` with `NO_COLOR`; temp dirs with `initRoot`; JSON stdout (spawn is never a TTY) — exemplar: `packages/cli/src/cli.test.ts`
- Store facts: `docs.write` returns the record; `setStatus` forward-only by rank; `slices.update` unrestricted; `notes.add({author,target,verdict?,body})`; `project.read()` throws if missing.
- Deps pinned exactly; the CLI adds none (frontmatter parsing comes from the store).
- Markdown templates read with `Bun.file(join(import.meta.dir, …))`; no bundling.
- Plugin frontmatter: Cursor agents `name, description, model, readonly`; Claude agents `name, description, tools`; skills `name, description` only.
- oxfmt: double quotes, semicolons, width 100; `bun run fmt` before commit.

## Verification

- `bun run check`
- `bun run typecheck`
- `bun test`
- `bun run build`

## Live test

- `export PATH="$HOME/.bun/bin:$PATH"`; worktree `/Users/aidenhadisi/aidengit/buildsmith-plugin` (branch `feat/plugin`); `bun install`.
- CLI: `bunx buildsmith …` inside the worktree; from a temp repo `bun /Users/aidenhadisi/aidengit/buildsmith-plugin/packages/cli/src/main.ts …` (set `BUILDSMITH_BIN` to that so briefs quote a runnable command).
- Temp repos: `mktemp -d` + `init`; removed after.
- `setup`: run with `HOME=$(mktemp -d)`; `claude`/`codex` are not installed on this machine → printed-commands path; Cursor `agent` CLI is at `~/.local/bin/agent` for `--plugin-dir` checks.
- Board: `PORT` is hardcoded 3000 and may be held by another session; use `createApp` in-process if needed.
- Nothing external is contacted; `setup` never runs `claude`/`codex` here.

## Design rulings

_Append-only. One line per critic objection._

- `brief` text mode never reaches a subagent because `io.json` is true in any non-TTY shell · Adopt · print text unless `--json` is literal; same for `prompt show|diff`.
- `{{cli}}` via `BUILDSMITH_BIN` env · Adopt · use `bun ${Bun.main}`, runnable from any cwd, no env contract.
- `yaml` dep in the CLI · Adopt · export `splitFrontmatter`/`parseYaml` from the store's `files.ts`.
- `setup` host detection · Adopt · default all three hosts; `Bun.which` only decides run vs print (criterion 5 needs dry-run for all three on a machine without claude/codex).
- Codex TOML generated from agent md · Adopt · ship a static `plugin/codex/buildsmith-worker.toml` and `copyFile`.
- Symlink over an existing real directory · Adopt · replace only symlinks; throw on a real dir.
- Critique loop stalls on `better-design` (status never advances, same draft re-critiqued) · Adopt · `brief <id> [action]` optional positional; skill rewrites via `write-<kind>` brief that includes the notes; cold-resume rule; revision cap.
- Note `target` free text makes `{{notes}}` filtering unsound · Adopt · fixed vocabulary `spec|architecture|slice-<n>|verification` pinned in every Record section.
- `{{doc}}` `(none)` for slice/verification actions; `{{slice}}` lacks `commit`; no `{{branch}}` · Adopt · architecture body for those actions; add `commit` and `branch`; no `column`.
- One template per role with `{{kind}}` · Reject (critic agreed) · `eject critique-spec` is a frozen criterion and spec/architecture critique differ in substance.
- Round 2 — "act on the return line" + cold-resume revision comparison not computable from CLI output · Adopt · one board-driven rule: newest note verdict on the target decides; writers record `revised`; gate on `role: user`; explicit exits for verification `fail` and user "no".
- `unblock-slice` has no owner · Adopt · `role: user`.
- `run-verification` cannot see the verification doc · Adopt · `{{verification}}` slot.
- `add-slice` only returns while no slices exist · Adopt · template says add all slices in one run.
- `parseYaml` does not throw · Adopt · validate frontmatter with `asEnum`.
- `json` via `process.argv` · Adopt · declare `json` on the leaf and read `args.json`.
- Trim `{{project}}` to sections per role · Reject · project.md is short by construction; one slot, no sectioning logic.
- Round 3 (Holds) — silent subagent loops forever · Adopt · liveness guard: one redispatch, then stop.
- Stale `better-design` after approval could un-approve · Adopt · check notes before acting, only for `spec|architecture` targets.
- Tester/unblock/coder-blocked outcomes unpinned · Adopt · tester note `pass|fail` on `verification`; unblock gate → note + `--status todo`; coder Record has `blocked`.
- `strong|fast` unmapped · Adopt · "your host's strongest/fastest model" stated in the skill.

## Slice log

_Append-only._

- [x] **Slice 1 — Store: loop-ready transitions + exports** · `41b57b0`
  - Criteria: `docs.write` on an existing spec/architecture → `draft`, revision+1 from any status; `next` → `review-slice` for a slice in `review` (preempts `doing`, loses to `blocked`); `splitFrontmatter`/`parseYaml` exported; tests pin all three; existing tests green.
  - Proven: `store.test.ts` rewrite → draft/rev 2, after `critiqued` → rev 3; walk test `review` → `review-slice`, `review`+`doing` → `review-slice`; 58 tests green.
- [x] **Slice 2 — Prompt templates + plugin package (content)** · `0a2a53d`
  - Criteria: 14 `packages/cli/prompts/<action>.md` with valid frontmatter, only the plan's slots, `{{extra}}` present, Record sections with the pinned targets/verdicts and exact `{{cli}}` commands; `packages/cli/plugin/` skill, two agents, codex TOML, three manifests, root marketplace.json; all JSON parses; no host tool/model names in templates.
  - Proven: slot grep = exactly the 14 allowed slots; 4 JSON files parse; `fmt:check` clean; `agent -p --plugin-dir packages/cli/plugin` lists `buildsmith-reader` and `buildsmith-worker`.
- [x] **Slice 3 — CLI: `brief` + `prompt`** · `cbe008b`
  - Criteria: `brief <id> [action]` text/`--json`/`nothing to do`; unknown slot errors; repo override, `.extra.md`; `prompt list|show|eject|diff`; tests via `cli.test.ts`.
  - Proven: 12 new CLI tests; live in `/tmp/bs-dog.*`: `eject` → edit shows in `brief`, `list` → `repo`, `diff` shows `-`/`+` lines, `.extra.md` appears without eject.
- [x] **Slice 4 — CLI: `setup` + README** · `0ce41db`
  - Criteria: `setup [hosts…] [--dry-run]` per Architecture §2; tests with `HOME` in a temp dir; README "Plugin" section.
  - Proven: `setup --dry-run` prints 6 steps for 3 hosts; `HOME=$(mktemp -d) PATH=/usr/bin:/bin setup cursor claude codex` → symlink resolves to the plugin dir, claude/codex `printed`, codex TOML copied; real `setup cursor` installed `~/.cursor/plugins/local/buildsmith`.
- [x] **Fix — note bodies with `##` headings** · `be41e1c`
  - Found in the dogfood run: the critic's note began with `## Verdict`, and `parseNotes` split it into empty notes. Only timestamped headings open a note now; test added.
- [x] **Dogfood** (temp repo, generic subagents told only "run `<cli> brief <id>` and follow it")
  - critique-spec on a padded spec → note `better-design`, status stayed `draft`; planner rewrite + `revised` note → rev 2; fresh critic → `holds`, `doc status critiqued`, `next` = `review-spec`.
  - work-slice → `greet.ts` + test committed, `slice update --status review --commit 2949062`; `next` = `review-slice`.
  - review-slice → note `pass` on `slice-1`, slice `done`; `next` = `write-verification`.
