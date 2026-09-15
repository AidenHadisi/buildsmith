# Derived columns

## What we're building

Today a task's kanban `column` is a stored field in `task.md`, set to `backlog` on create and changed only by `buildsmith task move`. Nothing in the pipeline moves it, so the board's lanes go stale while the real progress indicator, the computed `next.stage`, is shown only as a badge. We are removing the stored column and deriving it from the stage, so the board is consistent with the state machine by construction and there is nothing to move. Done means: `column`/`order`/`task move`/`columns` config/`fractional-indexing` are gone, `next.column` exists, and the board groups by it.

## Requirements

- `Next` carries `column`, derived deterministically from the snapshot: `backlog` when no spec document exists; otherwise `planning` for stages `project|spec|architecture`, `building` for `building|polish`, `review` for `review|verify`, `done` for `done`.
- `task.md` no longer contains `column` or `order`; files that still have them load fine.
- `buildsmith task move` is removed; `task` subcommands are `create, list, get, update`.
- `columns` is removed from config; `init` still writes a `config.yml` (commented template) so `.buildsmith/` is trackable and `loadConfig` keeps its "missing, run init" behavior.
- `listTasks` sorts by `updatedAt` descending, then `id`.
- `GET /api/board` returns `{ columns: COLUMNS, tasks }`, each task with `next.column`; the client groups by it.
- `fractional-indexing` is removed from `package.json` and `bun.lock`.

## Out of scope

- Manual ordering within a column (the user chose recency ordering).
- Custom column names or counts.
- Board drag-and-drop.

## Acceptance criteria

All proven live on `b0e8629`; PR https://github.com/AidenHadisi/buildsmith/pull/9

- [x] A freshly created task is in `backlog` — proof: `buildsmith task list` in a scratch repo shows `next.column: "backlog"`; `task.md` has no `column:`/`order:` lines.
- [x] Column follows the stage through the pipeline — proof: drive a scratch task spec → architecture → slices → polish → review → verification; `task list` reports `planning`, `building`, `review`, `done` at the corresponding points.
- [x] `task move` and column config are gone — proof: `buildsmith task --help` lists `create, list, get, update` only; `init`'s `config.yml` has no `columns`; `package.json` and `bun.lock` have no `fractional-indexing`.
- [x] The board groups cards by derived column — proof: `GET /api/board` returns `columns: [backlog, planning, building, review, done]` and tasks carry `next.column`; the served UI renders five lanes with a scratch task in the right one (screenshot).
- [x] Old task files still load — proof: a `task.md` with `column:`/`order:` lines is read by `task get` without error.
- [x] Within a column, most recently updated first — proof: two tasks in `backlog`, `task update` the older one, it lists first.
- [x] `bun run check`, `bun run typecheck`, `bun test` pass; README no longer documents `task move` or `columns`.

## Architecture

Components and the one job each owns:

- **Pipeline** (`src/pipeline.ts`) owns the stage → column rule. Adds `Column`, `COLUMNS` (ordered lane list), and `column` on `Next`. `decide()` computes it from the snapshot: `!s.spec ? "backlog" : LANE[stage]`. This is the only place the mapping lives.
- **Task store** (`src/store/tasks.ts`) owns task records. Drops `column`/`order` from the schema (stays `looseObject`, so old files parse), deletes `moveTask`, stops importing `loadConfig` and `fractional-indexing`. `listTasks` sorts by `updatedAt` desc, `id`.
- **Config** (`src/store/repo.ts`) owns `config.yml`. Drops `columns`; `Config = { models }`. `init` writes a comment-only template naming the `models` keys.
- **CLI** (`src/commands/task.ts`) drops `move`. `task list` already spreads `next`, so `next.column` appears with no change.
- **Board server** (`board/src/server/app.ts`) returns `columns: COLUMNS` from the pipeline instead of config.
- **Board client** (`board/src/client/main.tsx`) groups by `task.next.column` instead of `task.column`. Types flow from `AppType`, so no client type edits.

Seams: store → pipeline (snapshot in, `Next` out; unchanged direction). Server → pipeline (`COLUMNS`, `next`). Client → server JSON only. No new dependencies; one removed.

Decisions:

- Derivation lives in `decide()` rather than a separate function so `Next` stays the single computed truth and `task list`, `step`, and the board all get it for free.
- `backlog` keys off "spec document exists" rather than a stage, because stage `spec` covers both "not started" and "sent back for rewrite", and only the former is backlog.
- `init` keeps writing `config.yml` because an empty `.buildsmith/tasks/` would not survive git.

## Conventions

- Store functions throw `StoreError(code, message)`; CLI prints `{ error }` and exits 1 — exemplar: `src/store/tasks.ts`, `src/main.ts`.
- Citty subcommands: one file per group, inner `const` commands, default-export the group — exemplar: `src/commands/note.ts`.
- Store barrel `src/store/index.ts` uses named re-exports; commands import from the barrel.
- Pipeline rules are `when(test, result)` over a pure `Snapshot`; `decide()` is unit-tested with hand-built snapshots — exemplar: `src/pipeline.test.ts`.
- Board client: TanStack Query + Hono RPC (`api.api.board.$get()`), Tailwind classes, components under `board/src/client/components/`.
- Formatting `oxfmt`, lint `oxlint`; tests `bun test`; commits conventional with co-author trailer.

## Verification

- `bun run check`
- `bun run typecheck`
- `bun test`
- `bun run build`

## Live test

Scratch repo: `d=$(mktemp -d) && cd $d && git init -q && buildsmith init` (global `buildsmith` is a symlink to this checkout). Drive the pipeline with `task create`, `doc write`, `doc status`, `slice update`, `note add`, checking `task list` after each. Board: `bun run build` in the repo, then `bun src/main.ts board --no-open --port 3000` from the scratch repo; `curl localhost:3000/api/board` and open `http://127.0.0.1:3000` for a screenshot. Everything is local; no outbound calls.

## Design rulings

- `init` template must hold no live values (repo keys shadow the user file) · Adopt · comment-only template.
- Strip stale `column`/`order` in `toTask` so old files don't leak them into JSON · Reject · only this repo's dogfood tasks have them; new repos never will; less code wins and AC only requires "loads without error".
- Type `LANE` as `Record<Stage, Column>` and derive `Column` from `COLUMNS` so they cannot drift · Adopt.
- Compute `column` in `decide()` next to `ask`, not in `next()`, so snapshot unit tests cover it · Adopt.
- Sort with string compare on ISO timestamps, no `Date` parsing · Adopt.
- Enumerate breaking tests and README rows in the slices · Adopt.
- Slice order store-removal-before-board is red (`app.ts` reads `Config.columns`; `main.tsx` would render empty lanes) · Adopt · board consumes `next.column` before the stored field is deleted.
- Add live CLI proofs (fresh task `backlog`, full pipeline drive, README grep) to the removal slice; drop code-describing criteria; cite tests by name · Adopt.

## Slices

1. **Pipeline column** — `src/pipeline.ts`, `src/pipeline.test.ts`. `COLUMNS`, `Column = (typeof COLUMNS)[number]`, `LANE: Record<Stage, Column>`, `Next.column`, computed in `decide()` next to `ask` as `s.spec ? LANE[stage] : "backlog"`. Criteria: (a) no spec → `backlog`; (b) draft/critiqued/reviewed spec, and any architecture state → `planning`; (c) open slice, polish → `building`; (d) review-branch, run-verification → `review`; (e) all done → `done`; (f) `bun run typecheck` and `bun test` pass.
2. **Board by derived column** — `board/src/server/app.ts` returns `columns: COLUMNS`; `board/src/client/main.tsx` filters on `task.next.column`; README board sentence ("Columns from your config…"). `app.test.ts` "GET /api/board returns columns and tasks with next" keeps passing unchanged. Criteria: (a) `curl /api/board` returns `columns: [backlog, planning, building, review, done]` and every task has `next.column`; (b) `bun run build` and `bun run typecheck` pass; (c) live: served UI shows five lanes with a scratch task in `backlog`, screenshot.
3. **Remove stored column** — `src/store/tasks.ts`, `src/store/repo.ts`, `src/store/index.ts`, `src/commands/task.ts`, `package.json`, `bun.lock`, README (CLI table row, "Models and columns", on-disk tree `task.md` comment). Tests by name: cli.test "task --help lists create, list, get, move, update", "task list prints JSON with column and next.stage", "init, create, move, update, get round-trip in a temp repo"; store.test "create, get, list, update, move", "move with before/after", "move with short ids", "rejects an unknown column", "config layers built-in defaults, the user file, then the repo file"; files.test "init then findRoot from a nested cwd". Criteria: (a) fresh task: `task list` shows `next.column: "backlog"` and its `task.md` has no `column:`/`order:` lines; (b) `task --help` lists `create, list, get, update` only; (c) `init` writes a comment-only `config.yml`; `loadConfig` returns `{ models }`; (d) two backlog tasks, `task update` the older → it lists first; (e) a `task.md` with stale `column:`/`order:` lines passes `task get`; (f) `fractional-indexing` absent from `package.json` and `bun.lock`; (g) live drive spec → architecture → slices → polish → review → verification shows `planning`, `building`, `review`, `done` in `task list`; (h) `rg -n "task move|columns" README.md` is empty; (i) `bun run check`, `bun run typecheck`, `bun test` pass.

## Slice log

- [x] **Slice 1 — Pipeline column** · `a90e03d`
  - Criteria: (a) no spec → backlog; (b) spec/architecture states → planning; (c) open slice, polish → building; (d) review-branch, run-verification → review; (e) done → done; (f) typecheck + tests pass.
  - Proven: 12-row `test.each` table in `pipeline.test.ts` (incl. sent-back spec → planning); `bun run typecheck` clean for both projects; 118 tests pass; live `buildsmith task list` on a fresh scratch task → `{"stage":"project","column":"backlog"}`.
- [x] **Slice 2 — Board by derived column** · `190ea07`
  - Criteria: (a) `/api/board` returns `columns: COLUMNS` and tasks with `next.column`; (b) build + typecheck pass; (c) live UI shows five lanes with the scratch task in the right one.
  - Proven: `curl /api/board` → `columns: [backlog, planning, building, review, done]`, task `next.column: "backlog"`; after `doc write spec` → `"planning"`; screenshots `/tmp/buildsmith-board-backlog.png`, `/tmp/buildsmith-board-planning.png` (opened: Backlog 0 / Planning 1 / others 0, console clean); typecheck, 118 tests, Vite build pass.
- [x] **Slice 3 — Remove stored column** · `b0e8629` (polish `HEAD`)
  - Criteria: (a)–(i) as listed under Slices.
  - Proven: whole-feature live drive in a scratch repo — fresh task backlog, `task --help` without move, comment-only config.yml, recency ordering `[beta, alpha]` → `[alpha, beta]` after update, stale `column:`/`order:` file loads, full pipeline drive planning → building → review → done, `/api/board` + screenshot `/tmp/buildsmith-final-board.png` (Backlog 1 / Done 1); check, typecheck, 116 tests pass.
