# CLI

## What we're building

`@buildsmith/store` reads and writes `.buildsmith/` and the web board renders it, but the only way an agent can change the board today is to hand-edit markdown — bypassing ids, ordering, the doc status ladder, revision bumps and locks. We are adding `packages/cli`: a `buildsmith` binary that mirrors the store one-to-one so an agent in Cursor or Claude Code can manage the board from a shell. JSON on stdout when stdout is not a TTY (or `--json`), readable text when it is; errors to stderr with exit 1; `--help` everywhere; doc/note bodies from `--file` or piped stdin; short ids accepted. Runnable in the monorepo as `bunx buildsmith`. Done means the seven acceptance criteria below are proven live and a full pipeline can be driven through the CLI into a fresh repo that the web board then renders.

## Requirements

- Commands: `init [dir]`, `next <id>`, `task create|list|get|move|update`, `doc write|read|status|result`, `slice add|list|update`, `note add|list`, `project read|write|lesson`, `asset put`.
- `<id>` accepts a full UUID or any unique prefix/suffix of one; ambiguous or unknown → clear error.
- Output: JSON when `!process.stdout.isTTY` or `--json`; otherwise compact human text.
- Errors: message on stderr, exit 1; in JSON mode stderr carries `{"error": "..."}`; never a stack trace for expected store errors.
- Bodies: `--file <path>` or stdin when stdin is not a TTY; neither → usage error.
- `task list` includes `next` per task (it is the board).
- Root `package.json` depends on `@buildsmith/cli` so Bun links `node_modules/.bin/buildsmith`.
- Tests spawn the binary against a temp store.

## Out of scope

- Plugin / skills / agent definitions — next feature; the CLI is what they call.
- `buildsmith setup` to install the plugin into Cursor / Claude Code / Codex — follows the plugin (Stripe `agent setup` pattern).
- MCP server; `watch` command; `bun build --compile`; npm publish.
- `pino` — dropped; a CLI logs to stderr.
- Erroring on unknown flags — citty 0.2 parses with `strict: false`.

## Acceptance criteria

Frozen on approval. A box is checked only with evidence from a live run. All writes against this repo's `.buildsmith/` are reverted with `git checkout -- .buildsmith`; pipeline runs use a temp repo.

- [x] **Discoverable** — proof: `bunx buildsmith --help` lists every command group; `bunx buildsmith task --help` and `bunx buildsmith doc write --help` document args and flags; unknown command or missing required arg → usage on stderr, exit 1.
  Evidence: `USAGE buildsmith [OPTIONS] init|next|task|doc|slice|note|project|asset` + `--json`; `doc write --help` → `KIND Document kind (spec|architecture|verification) (Required)`, `--file=<file>`; `bogus` → stderr usage + `Unknown command bogus`, exit 1; `task get` → `Missing required positional argument: ID`, exit 1, empty stdout.
- [x] **Board read path** — proof: `bunx buildsmith task list | jq` returns the two seed tasks with `column` and `next.stage`; `task get <A>` and `next <A>` agree with `GET /api/tasks/<A>`; the same commands in a TTY print text, not JSON.
  Evidence: `{MCP server, backlog, spec}`, `{Web board, building, building}`; `task get`/`next` deep-equal API `.task`/`.next` (`{"stage":"building","action":"work-slice","reason":"slice 2 is doing"}`); pty run → `id: 01a09815-…` / `title: Web board` / `stage: building`.
- [x] **Full pipeline via CLI** — proof: in a temp dir: `init` → `task create` → `doc write spec` (stdin) → `doc status` to `critiqued`, `reviewed`, `approved` → `doc write architecture` + approve → `slice add` ×2 → `slice update 1 --status done --commit abc` → `note add` → `doc write verification` → `doc result pass`; `next` reports stage `done`; the web server with `BUILDSMITH_ROOT=<tmp>` serves that task at `/api/tasks/<id>`.
  Evidence: 17 steps exit 0 in `bs-c3-jZyaGx`; `next` → `{"stage":"done","action":"none","reason":"all pipeline steps complete"}`; `createApp(openStore(tmp)).request("/api/tasks/01a0990e-…")` → 200, `next.stage: "done"` (port 3000 held by another session, so the app was exercised in-process).
- [x] **Short ids** — proof: `task get e1b5d5` resolves task A; `task get 01a09815` (matches both seeds) → stderr "ambiguous", exit 1; `task get nope` → stderr not found, exit 1.
  Evidence: `e1b5d5` → `"title": "Web board"`, exit 0; `01a09815` → `{"error":"ambiguous task id 01a09815"}`, exit 1; `nope` → `{"error":"task nope not found"}`, exit 1.
- [x] **Store errors surface cleanly** — proof: `doc status <A> spec draft` → stderr contains `cannot move spec status`, exit 1; with `--json`, stderr is `{"error":"..."}`; no stack trace in either.
  Evidence: stderr exactly `{"error":"cannot move spec status from draft to draft"}` piped and with `--json`, `at ` count 0, exit 1; pty → plain `cannot move spec status from draft to draft`.
- [x] **Body input** — proof: `doc write <id> spec --file f.md` and `cat f.md | buildsmith doc write <id> spec` yield byte-identical `spec.md` bodies; with a TTY stdin and no `--file` → usage error, exit 1.
  Evidence: `cmp` exit 0 (63 bytes each), body `# Spec\n\nByte identical body.\n`; pty stdin without `--file` → `empty body: provide --file or pipe a body on stdin`, exit 1, no `spec.md` written.
- [x] **Green checks** — proof: `bun run check`, `bun run typecheck`, `bun test` (incl. CLI spawn tests), root `bun run build` pass; `ls node_modules/.bin/buildsmith` exists after `bun install`.
  Evidence: all four green, `58 pass 0 fail`; `node_modules/.bin/buildsmith -> ../@buildsmith/cli/src/main.ts`.

## Architecture

Two components inside `packages/cli/src/` plus one small change in the store; the CLI depends only on `@buildsmith/store`.

### 0. Store — short-id resolution in `taskDir`

`taskDir` today matches `name.startsWith(`${id}-`)`, so `tasks.get("01a09815")` silently returns whichever seed `readdir` lists first — the web API has the same bug. Fix at the choke point: skip dot-names (same filter as `listTasks`), compare `ref` against `taskIdFromDir(name)` by equality, `startsWith` or `endsWith`; 0 hits → `task <ref> not found` (unchanged message); >1 → `ambiguous task id <ref>`. `move` compares by `dir` (already on `TaskRecord`): `t.dir !== dir`, and `before`/`after` refs go through `taskDir` too, so short refs work there without re-deriving ids. Two store tests. Every consumer — CLI, web, later MCP — gets the same behaviour; the CLI has no id code.

Also export the enum schemas from the barrel (`docKindSchema`, `docStatusSchema`, `sliceStatusSchema`, `verificationResultSchema`) so CLI `enum` args use `schema.options` and help text can't drift from validation.

### 1. Command tree — `main.ts` + `commands/*.ts`

Owns: the shape of the CLI (names, args, help). One citty `defineCommand` per store namespace (`task.ts`, `doc.ts`, `slice.ts`, `note.ts`, `project.ts`, `asset.ts`) plus `init.ts` and `next.ts`, statically imported; each file exports a command whose `subCommands` are the store's methods. A store-backed leaf is one line: `run: act((store, args) => store.tasks.get(args.id))`. No business logic here — validation of columns, statuses, transitions stays in the store and surfaces as its error messages. `init` is the only leaf without `act` (no store yet): `initRoot(dir)` then `print`.

`main.ts`: root command with `meta` (name, `version` via `import { version } from "../package.json" with { type: "json" }`, description), `args: { json: { type: "boolean" } }` (documentation only — see `io.ts`), static `subCommands`; `runMain(root, { showUsage })` where `showUsage: async (cmd, parent) => (help ? console.log : console.error)(await renderUsage(cmd, parent))` and `help = process.argv.some((a) => a === "--help" || a === "-h")` (citty does not tell `showUsage` why it was called), so citty `CLIError`s (unknown command, missing required) land on stderr with exit 1 and `--help`/`--version` keep working at every level (`runCommand` skips help handling and citty does not export `CLIError`/`resolveSubCommand`, so hand-rolling that path would copy citty internals). `#!/usr/bin/env bun` shebang, `chmod +x src/main.ts` (committed mode); `package.json` `bin: { buildsmith: "./src/main.ts" }`. Required positionals declare `required: true` so `args.id` types as `string`.

### 2. IO helpers — `io.ts`

Owns: everything that is about the shell rather than the board.

- `json` — module constant: `!process.stdout.isTTY || process.argv.includes("--json")`. citty parses parent args at the parent and forwards only the remaining raw args, so `buildsmith --json task list` would otherwise drop the flag; one argv scan works in any position and removes a spread from every leaf.
- `act(fn)` — returns a citty `run`: `openStore(process.cwd())`, `await fn(store, args)`, `print(result)`; on an `Error` writes `{"error": msg}` (JSON mode) or `msg` to stderr and sets `process.exitCode = 1` (never `process.exit`, which can truncate buffered stdout); non-`Error` rejections rethrow. Store errors therefore never reach `runMain`, so no stack trace and no usage dump. (`runMain` returns without exiting on success, so `exitCode` is honoured.)
- `body(file?)` — `Bun.file(file).text()`, else `Bun.stdin.text()` when stdin is not a TTY, else `""`; an empty result throws `empty body: provide --file or pipe a body on stdin` (covers a TTY, `/dev/null`, `stdin: "ignore"` from a spawned process, and an empty file). Treating empty as "no body" also makes the "neither" case testable from `Bun.spawn`.
- `print(value)` — JSON mode: `JSON.stringify(value, null, 2)`. Text mode: `string` → raw; `undefined` → nothing; record → `key: value` lines, nested records flattened one level (`next.stage: spec`), arrays of strings joined with `, `, multi-line strings (`body`, `description`) printed raw on the following lines; array of records → records separated by a blank line. No tables, no per-type formatters. Keys dimmed with picocolors. `init` returns the root path (a JSON string in JSON mode).

### Wiring

- `packages/cli/package.json`: `bin`, scripts `typecheck`/`test`, deps `@buildsmith/store`, `citty 0.2.2`, `picocolors 1.1.1`; remove `pino`.
- Root `package.json`: `"@buildsmith/cli": "workspace:*"` in `dependencies` so `bun install` links `node_modules/.bin/buildsmith`.
- `packages/store/src/store.ts` + `store.test.ts` (taskDir), `index.ts` (enum exports).
- `src/cli.test.ts`: helper `run(args, { cwd, stdin })` → `Bun.spawn(["bun", main, ...args], { cwd, stdin, stdout: "pipe", stderr: "pipe" })`; fixtures via `initRoot` in a temp dir; covers help, list/get JSON, short-id resolution + ambiguity, body from file/stdin/neither (`stdin: "ignore"`), a store error in text and `--json` mode, and the full pipeline ending in `next` → `done`.

### Key decisions

- Mirror the store, no workflow verbs: one tested code path per command; sugar can come with the plugin once real usage shows what is awkward.
- TTY switch for output: agents get JSON without remembering a flag; humans get text.
- `runMain` + `act` instead of `runCommand` + try/catch: keeps citty's help/version handling, isolates store errors in one helper.
- Short-id resolution lives in the store's `taskDir`: it already does inexact matching (wrongly); fixing it there serves every consumer.
- `task list` computes `next` per task with `Promise.all`, same three lines as `/api/board`; not shared until a third consumer appears.

## Conventions

- ESM, `.ts` import extensions, `import type`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUncheckedIndexedAccess` — exemplar: `packages/store/src/store.ts`
- oxfmt defaults; `bun run fmt` before commit. Plain `Error` with a message; no custom classes.
- Tests: `bun:test`, colocated, `mkdtemp` + `afterEach` cleanup, `initRoot` + `openStore` fixture — exemplar: `packages/store/src/store.test.ts`. CLI tests spawn `bun src/main.ts …` with `cwd` set to the temp repo and read `stdout`/`stderr`/`exited` (`runMain` calls `process.exit`).
- Store facts: `openStore(cwd)` walks up via `findRoot`, throws `no .buildsmith directory`; `tasks.get` throws `task <id> not found`; `docs.read` → `null` when absent; `docs.setStatus` throws `cannot move <kind> status from X to Y`; `next(store, id)`; `assets.put(taskId, name, bytes)`.
- citty 0.2.2: `defineCommand` with `args` types `string|boolean|positional|enum`; exports `defineCommand, runMain, runCommand, renderUsage, showUsage, parseArgs` — not `CLIError`; `runMain(cmd, { showUsage })` handles `--help`/`--version`, prints the error via `console.error` and exits 1; parent args are not forwarded to subcommands; unknown flags pass through (`strict: false`).
- Bun: `Bun.file(path).text()` / `.bytes()`, `Bun.stdin.text()`, `process.stdin.isTTY` is `undefined` when piped; `import … from "../package.json" with { type: "json" }` works under Bun and the repo tsconfig; workspace `bin` is linked only if another workspace package depends on it.
- Package scripts per workspace: `typecheck: tsc --noEmit`, `test: bun test`; deps pinned exactly.

## Verification

- `bun run check`
- `bun run typecheck`
- `bun test`
- `bun run build`

## Live test

- `export PATH="$HOME/.bun/bin:$PATH"`; `bun install` at the root (links `node_modules/.bin/buildsmith`).
- Run: `bunx buildsmith <cmd>` from anywhere under the repo (store found by walking up), or `bun packages/cli/src/main.ts <cmd>`.
- Data: this repo's `.buildsmith/` (task A `01a09815-35cb-7313-b058-5656c1e1b5d5` "Web board", task B `01a09815-35dd-732e-9976-970613e2c0a8` "MCP server"). Writes here must be reverted with `git checkout -- .buildsmith`.
- Pipeline checks use `mktemp -d` + `bunx buildsmith init` there; the web server is `BUILDSMITH_ROOT=<tmp> bun apps/web/src/server/index.ts` (port 3000).
- Nothing external is contacted.

## Design rulings

_Append-only. One line per critic objection._

- Adopt — `runCommand` skips `--help`/`--version` and citty exports neither `CLIError` nor `resolveSubCommand`; use `runMain` + custom `showUsage` + `act()` wrapper.
- Adopt — store `taskDir` already matches `01a09815` to the wrong seed silently; move short-id/ambiguity resolution into `taskDir` (fixes web API too), delete `resolveId`.
- Adopt — citty does not forward parent args to subcommands, so `...jsonArg` per leaf still misses `buildsmith --json task list`; one `process.argv.includes("--json")` constant, root declares `json` for help.
- Adopt — "generic renderer with chosen columns" was per-type formatting in disguise; define text mode as string/record/array rules, no tables.
- Adopt — empty non-TTY stdin must be a usage error, not an empty doc; also makes the "neither" case testable via `stdin: "ignore"`.
- Adopt — `process.exitCode = 1` instead of `process.exit(1)` inside commands.
- Adopt — export enum schemas from the store barrel; use `.options` in CLI enum args.
- Adopt — static imports for subcommands; laziness buys nothing for eight small modules and root help resolves them all anyway.
- Reject — drop picocolors for `Bun.color`: user chose to keep picocolors; one tiny dep, no behaviour difference.
- Reject — shared `board(store)` in store for CLI + web: three duplicated lines; wait for a third consumer.
- Adopt — `move --before/--after` refs resolve through `taskDir` too, and `move` compares against the resolved full id.
- Confirm — `pino` removed in slice 1; `asset put` = `basename(file)` + `Bun.file(file).bytes()`, ENOENT surfaces through `act`.
- Round 2 (Holds) — Adopt: `taskDir` skips dot-names; `move` compares by `dir`; `help` detected from argv for `showUsage`; `required: true` on positionals; `act` rethrows non-`Error`; `chmod +x main.ts`; `body` message reworded `empty body: …`; text mode defines string-arrays and multi-line strings; `init` JSON is a string.

## Slice log

_Append-only._

### Slice 1 — store: short ids + enum exports

Files: `packages/store/src/store.ts`, `store.test.ts`, `index.ts`.

- [x] `tasks.get("e1b5d5")` (suffix) and `tasks.get("01a09815-35cb")` (prefix) return task A; full id still works. Proven: all three → `"Web board"` / `01a09815-35cb-…`.
- [x] Ref matching both seeds → `ambiguous task id <ref>`; unknown → `task <ref> not found`; a `.lock`/`.DS_Store` entry in `tasks/` never matches. Proven: `ambiguous task id 01a09815`, `task nope not found`; dot entries via test `get rejects ambiguous and unknown refs and ignores dot entries` (`get(".lock")`, `get("Store")` → not found).
- [x] `tasks.move(shortA, col, { after: shortB })` places A right after B in `tasks.list()` order; `before`/`after` errors and the self-exclusion filter use the resolved `dir`. Proven: temp store `list_titles=["B","A"]`; `after: shortA` → `task cf7c317783a6 not found in backlog`.
- [x] Web `findTask` maps `ambiguous task id` to 400. Proven: `curl /api/tasks/01a09815` → `400 {"error":"ambiguous task id 01a09815"}`; `/api/tasks/e1b5d5` → 200 task A.
- [x] Enum schemas exported; checks green. Proven: `.options` printed for all four; `check`/`typecheck`/`test` (35 pass)/`build` green.

Note: work moved to a dedicated worktree `/Users/aidenhadisi/aidengit/buildsmith-cli` because another session shares the main checkout and stashed/switched branches mid-run.

### Slice 2 — CLI scaffold: io, main, init/next/task

Files: `packages/cli/{package.json,tsconfig.json,src/main.ts,src/io.ts,src/commands/{init,next,task}.ts,src/cli.test.ts}`, root `package.json`.

Arg shapes (store signatures): `init [dir]` (default cwd; returns root path; `.buildsmith/project.md` exists after); `next <id>`; `task create --title T [--description D] [criteria…]`; `task list`; `task get <id>`; `task move <id> <column> [--before ref] [--after ref]`; `task update <id> [--title] [--description] [--branch] [--pr] [criteria…]`. Multi-value criteria are rest positionals (`args._.slice(n)`, n = declared positionals) because citty 0.2.2 does not collect repeated flags (last wins) — each leaf comments the slice count.

- [x] Help / usage errors. Proven: `USAGE buildsmith [OPTIONS] init|next|task` with `--json`; `task --help` → `create|list|get|move|update`; `task get --help` → `ID … (Required)`; `bogus` and `task get` → usage + message on stderr, empty stdout, exit 1, zero `at ` lines.
- [x] Read path. Proven: `task list | jq` → `{MCP server, backlog, spec}`, `{Web board, building, building}`; `--json` before/after → length 2 both; `script -q /dev/null … task get e1b5d5` → `id: …` / `title: Web board` text; `task get`/`next` deep-equal `/api/tasks/<A>` `.task`/`.next` (`{"stage":"building","action":"work-slice",…}`).
- [x] Short ids. Proven: `task get 01a09815` → stderr `{"error":"ambiguous task id 01a09815"}` (piped) / `ambiguous task id 01a09815` (TTY), exit 1; `nope` → `task nope not found`.
- [x] Temp repo round-trip. Proven: `init` → `".../tmp.DJQY7miW6f/.buildsmith"`; create/move/update → `task get` `{ "column": "planning", "branch": "b", "criteria": ["c1","c2"] }`. Note: `bunx buildsmith` only resolves inside the repo (workspace bin); outside it use `bun <repo>/packages/cli/src/main.ts`.
- [x] Void/`null` print nothing. Proven: test `print > prints nothing for undefined or null`; `task update` returns the record and prints it.
- [x] Wiring. Proven: `node_modules/.bin/buildsmith -> ../@buildsmith/cli/src/main.ts`; `grep -c pino` → 0/0; `check`/`typecheck` (3 workspaces)/`test` (46 pass)/`build` green.

### Slice 3 — doc/slice/note/project/asset + pipeline

Files: `packages/cli/src/commands/{doc,slice,note,project,asset}.ts`, `main.ts`, `cli.test.ts`.

Arg shapes: `doc write <id> <kind> [--file]` (kind = `docKindSchema.options`); `doc read <id> <kind>`; `doc status <id> <spec|architecture> <status>` (status = `docStatusSchema.options`); `doc result <id> <pass|fail>`; `slice add <id> --title T --goal G criteria…`; `slice list <id>`; `slice update <id> <n> [--status] [--commit]` (`n` via `Number`, non-numeric → store's `slice NaN not found` accepted); `note add <id> --author A --target T [--verdict V] [--file]` (body via `body()`); `note list <id> [--target]`; `project read`; `project write [--file]`; `project lesson [--file]`; `asset put <id> <file>`.

- [x] Body input. Proven: `--file f.md` vs `< f.md` → `cmp a.md b.md` exit 0 (78 bytes identical); `< /dev/null` → `{"error":"empty body: provide --file or pipe a body on stdin"}`, exit 1; `doc read <id> architecture` → `null`, exit 0.
- [x] Round-trips + store error. Proven: `slice list` → 2 slices `done` with commits `abc`/`def`, `criteria: ["c"]`; `note list --target spec` → `{author: me, verdict: ok, body: looks good}`; `project lesson` visible under `## Lessons` in `project read`; `asset put` → `assets/f.md` identical to source; `doc status <id> spec draft` → `{"error":"cannot move spec status from draft to draft"}` (piped/`--json`) / plain text in TTY, exit 1, no `at ` lines.
- [x] Full pipeline. Proven: fresh temp repo, 17 CLI steps all exit 0, `next` → `{"stage":"done","action":"none","reason":"all pipeline steps complete"}`; `createApp(openStore(tmp)).request("/api/tasks/<id>")` → 200 with `next.stage: "done"` (port 3000 held by another session, so in-process request).
- [x] Tests + checks. Proven: `pipeline > full pipeline drives next to done in a temp repo`; `check`/`typecheck`/`test` (58 pass)/`build` green.

Note: citty 0.2.2 enum validation applies to named flags only; positional kinds/statuses go through a 4-line `asEnum(value, schema)` in `io.ts` (Zod's own error message is a multi-line JSON blob, unfit for the one-line stderr contract). `print(null)` emits `null` in JSON mode so `doc read` of a missing doc is distinguishable.

Slice-critic rulings (Holds): Adopt — rest positionals for criteria (citty last-wins verified); `task create` has no `--column`; `doc read` + `null`/void printing specified; `doc status` kind enum narrowed; `note add` flags named; `move` criterion made observable; web `findTask` maps ambiguity; `--json` position asserted; `init` default + observable. Accept — `slice update` non-numeric `n` surfaces the store message.
