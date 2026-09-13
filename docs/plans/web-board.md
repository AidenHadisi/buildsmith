# Web board

## What we're building

`@buildsmith/store` (packages/store) reads and writes a repo's `.buildsmith/` folder: `config.yml`, `project.md`, and one folder per task holding `task.md`, `spec.md`, `architecture.md`, `verification.md`, `slices/NN-slug.md`, `notes.md`, `assets/`. Nothing renders it yet; the only way to see the board is to open the files.

We are adding `apps/web`: a read-only Kanban board over that folder. A Vite SPA (React 19, Tailwind 4, shadcn on Base UI, TanStack Query) talks to a small Hono server on Bun that wraps the store. Columns come from `config.yml`; each card opens a side sheet with Overview / Spec / Architecture / Slices / Notes / Verification, markdown rendered, images served from the task's `assets/`. The server pushes `store.watch()` events over SSE so the page refreshes as the agent edits files. The dev server dogfoods this repo's own committed `.buildsmith/`. Done means the eight acceptance criteria below are proven live and `bun run build` + `bun run start` serve the same board without Vite.

## Requirements

- One column per `config.yml` column, in order; cards show title, short id, and the derived stage (from `next()`).
- Clicking a card opens a side sheet; `?task=<id>` in the URL reopens it on reload.
- Sheet tabs: Overview (description, criteria, branch/PR, next action), Spec, Architecture, Slices, Notes, Verification.
- Markdown rendered with GFM; relative `assets/...` image links resolve to the server's asset route.
- Pipeline frontmatter (status, revision, slice status/commit, verification result) is visible.
- File changes on disk appear in the UI within ~1 s via SSE, no reload.
- Client and server share route types through Hono RPC; no hand-written fetch URLs.
- Production: `vite build` output served by the Hono server from `dist/`.
- `.buildsmith/` committed at the repo root with realistic seed tasks.

## Out of scope

- Editing, drag-and-drop, creating tasks — v1 is read-only; the agent manages the board via MCP later.
- MCP server and CLI packages.
- Auth — local tool on localhost.
- Routing library — a single `?task=` search param is enough.
- Syntax highlighting in code blocks — plain `<pre>` for now.
- `bun build --compile` single binary — later, once the CLI exists.

## Acceptance criteria

Frozen on approval. A box is checked only with evidence from a live run.

- [ ] **Board renders from config** — proof: `bun run dev` in `apps/web`, open `http://localhost:5173`; one column per `columns` entry in `.buildsmith/config.yml`, in order, each with its cards (title, short id, stage badge); an empty column renders empty, not missing.
- [ ] **Card detail sheet** — proof: click a card; side sheet opens with tabs Overview, Spec, Architecture, Slices, Notes, Verification; URL gains `?task=<id>`; reloading that URL reopens the same sheet; closing removes the param.
- [ ] **Markdown + assets** — proof: a task doc with a GFM table, task list, fenced code and `![](assets/shot.png)` renders as HTML; the image loads from `/tasks/<id>/assets/shot.png` with 200 and `image/png`; `/tasks/<id>/assets/../../config.yml` returns 4xx.
- [ ] **Pipeline state visible** — proof: Spec/Architecture tabs show `status` and `revision`; Slices tab lists each slice with status and commit; Verification shows `result`; Overview shows `next()` action/reason and `blocked` when a slice is blocked.
- [ ] **Live refresh** — proof: with the page open, edit a task's `task.md` title on disk; the card updates within ~1 s without reload; `curl -N http://localhost:3000/events` shows the SSE stream with a heartbeat.
- [ ] **Typed API** — proof: `GET /api/board` and `GET /api/tasks/:id` return JSON; unknown id → 404 JSON; client uses `hc<AppType>`; renaming a response field on the server fails `tsc` on the client.
- [ ] **Green checks** — proof: `bun run check`, `bun run typecheck`, `bun test` pass at the root; `bun run build` in `apps/web` writes `dist/`; `bun run start` serves the board at `http://localhost:3000` without Vite.
- [ ] **Dogfood data** — proof: `.buildsmith/` at the repo root is committed with `config.yml`, `project.md`, and at least two tasks: one exercising every tab (spec, architecture, slices, notes, verification, an asset image) and one in `backlog` with only `task.md`.

Nothing reaches outside the machine. Tests touch only `.buildsmith/` files they can revert.

## Architecture

Three components, one-way dependencies: **client → server → store**. The client never imports store runtime code; it sees the server only through Hono RPC types.

### 1. Server — `apps/web/src/server/`

Owns: turning the store into HTTP. One Hono app, routes chained so `AppType` is inferable.

- `index.ts` — entry. `openStore(process.env.BUILDSMITH_ROOT ?? process.cwd())`, `Bun.serve({ fetch: app.fetch, port: 3000 })` (no `idleTimeout`; the SSE ping keeps streams alive).
- `app.ts` — `createApp(store)` returns the Hono app; `export type AppType`.
  - `GET /api/board` → `{ columns: string[], tasks: BoardTask[] }` where `BoardTask = TaskRecord & { next: NextAction }`. Built from `store.tasks.list()` + `next(store, id)` per task (`Promise.all`).
  - `GET /api/tasks/:id` → `{ task, next, spec, architecture, verification, slices, notes }` (docs nullable), all reads in one `Promise.all`. `store.tasks.get` throws on a missing task: map only the store's "not found" message to 404 `{ error }`, rethrow anything else (corrupt frontmatter must not look like 404). No validator: `:id` is already a string.
  - `GET /events` → `streamSSE`; subscribes `watch(store.root, …)`, sends `event: change` with the `WatchEvent` JSON, `event: ping` every 5 s (keeps Bun's default 10 s `idleTimeout` alive without server options). Ping loop is `while (!stream.aborted && !stream.closed)`; `onAbort` unsubscribes `watch`, so a closed tab releases its `fs.watch`.
  - `GET /tasks/:id/assets/*` → `resolve(task.dir, "assets", rest)`; `relative(assetsDir, p)` starting with `..` → 403; `Bun.file(p).exists()` false → 404; else `new Response(file)` (Bun sets Content-Type). No `realpath`: localhost read-only tool, symlink escape is not a threat.
  - `app.get("/api/*", …404 json)` after the API routes so the JSON-404 contract holds for the whole prefix.
  - Last: `serveStatic({ root })` with `root = join(import.meta.dir, "../../dist")` (not cwd-relative). No SPA fallback: the app has one page (`/` + `?task=`), so `/` → `index.html`, `/assets/*.js` → correct MIME, and every other unknown path stays 404 (keeps the traversal 4xx check honest). `/api`, `/events`, `/tasks/:id/assets/*` are registered earlier and never reach static.
- Hides: store shape, file layout, path safety. Changes here are contained by RPC types.
- Known limit (v1): `store.config` is read once at startup; editing `config.yml` needs a server restart.

### 2. Client — `apps/web/src/client/`

Owns: rendering board state; nothing else. `import type { AppType }` from the server is the only cross-boundary import.

- `main.tsx` — React root, `QueryClientProvider`, Tailwind css import.
- `api.ts` — just `hc<AppType>("/")` plus `BoardTask`/`TaskDetail` types; components call `useQuery` inline with `parseResponse` from `hono/client` (throws on non-2xx and types the 200 body) (`InferResponseType` for types), no wrapper hooks. `useLiveRefresh()` — one `EventSource("/events")`; `invalidateQueries()` on `change` **and** on `open` (a `bun --watch` restart drops events; reconnect must refetch).
- `useTaskParam()` — reads/writes `?task=` with `URLSearchParams` + `history.pushState`, listens to `popstate`.
- Components: `Board` (columns from `board.columns`, groups tasks by `column`), `TaskCard` (title, short id, `StageBadge` from `next.stage`), `TaskSheet` (shadcn `Sheet` + `Tabs`; loads `useTask`), `DocView` (status/revision header + `Markdown`), `SliceList`, `NoteList`, `Markdown` (react-markdown + remark-gfm, `urlTransform` rewrites `assets/…` → `/tasks/<id>/assets/…`).
- `components/ui/` — shadcn-generated (Base UI): sheet, tabs, badge, scroll-area, tooltip. Not hand-edited.
- Hides: how state arrives (query + SSE) and how docs render.

### 3. Dogfood data — `.buildsmith/` at repo root

Owns: the seed the dev server shows. `config.yml` (default columns), `project.md` (real run/check/live-test instructions for this repo), two tasks: `<id>-web-board` in `building` with spec/architecture (approved), 3 slices (done/doing/todo), notes, verification (draft), `assets/board.png`; `<id>-mcp-server` in `backlog` with only `task.md`. Written with the store itself (a throwaway script, not committed) so frontmatter matches the schemas exactly.

### Wiring

- `apps/web/index.html` (Vite root) loads `/src/client/main.tsx`; `dist/` already gitignored.
- `vite.config.ts`: `@vitejs/plugin-react`, `@tailwindcss/vite`, `resolve.alias` `@` → `src/client` (tsconfig `paths` mirrors it for shadcn imports), `server.proxy` for `/api`, `/events`, `/tasks` → `http://localhost:3000` (no timeout tweaks; the heartbeat resets Vite's inactivity timers).
- Deps to add: `@tanstack/react-query`, `react-markdown`, `remark-gfm`, `@base-ui/react` (shadcn Base UI target). Remove `@hono/zod-validator` and `@modelcontextprotocol/hono` (unused here; MCP re-adds it).
- `apps/web/package.json` scripts: `dev` = `bun run --parallel dev:server dev:client`; `dev:server` = `bun --watch src/server/index.ts`; `dev:client` = `vite`; `build` = `vite build`; `start` = `bun src/server/index.ts`; `typecheck` = `tsc --noEmit`.
- `apps/web/tsconfig.json` adds `paths` for the `@/` alias shadcn expects (root already sets `jsx: react-jsx`). Root `typecheck` **must** become `bun run --filter '*' typecheck`: root `tsc` has no `include` and would type-check `apps/web/src` without DOM libs.

### Key decisions

- Separate Hono process, not a Vite plugin: same code path in dev and prod; Vite is a static-asset concern only.
- SSE is a cache-invalidation signal, not a data channel — keeps the client on one fetch path.
- Board payload carries `next` per task so the server is the only place that knows pipeline rules.
- No router, no global state library: `?task=` + TanStack Query is the whole state.
- Asset route is hand-written (not `serveStatic`) because the root is per task and 403/404 must stay distinct.
- Board payload includes `TaskRecord.dir` (absolute path) and `next.blocked[].file`; harmless on localhost, not stripped.

## Conventions

- ESM, `.ts`/`.tsx` import extensions, `import type` for types (`verbatimModuleSyntax`, `erasableSyntaxOnly`: no enums, no parameter properties) — exemplar: `packages/store/src/store.ts`
- Root `tsconfig.json` is strict with `noUncheckedIndexedAccess`; `apps/web/tsconfig.json` extends it adding `DOM` libs. Root `typecheck` must cover the web app too: change root script to `bun run --filter '*' typecheck` and give every workspace a `typecheck` script (store already has one).
- oxlint + oxfmt on defaults: double quotes, semicolons, width 100, 2 spaces, trailing commas. Run `bun run fmt` before committing.
- Errors are plain `Error` with a message; no custom classes — exemplar: `packages/store/src/files.ts`
- Tests: `bun:test`, colocated `*.test.ts`, temp dirs via `mkdtemp` + `afterEach` cleanup, `initRoot` + `openStore` to build a fixture store — exemplar: `packages/store/src/store.test.ts`. Server route tests call `app.request(...)` against a temp store; no client unit tests in v1.
- Store API facts: `openStore(cwd)` walks up via `findRoot` and throws `no .buildsmith directory` if absent; `tasks.get(id)` throws on a missing task (catch → 404); `docs.read` returns `null` when absent; `next(store, id)` is async; `watch(root, cb)` returns an unsubscribe fn; `TaskRecord.dir` is the task's absolute folder.
- Store barrel does not export schemas or `DEFAULT_COLUMNS`; the server reads columns from `store.config.columns`.
- Prefer less code: no barrel files in the client, no wrapper hooks without a second caller, shadcn `components/ui/*` left as generated.

## Verification

- `bun run check` (oxlint + oxfmt, root)
- `bun run typecheck` (root, runs every workspace's `tsc --noEmit`)
- `bun test` (root)
- `bun run build` in `apps/web`

## Live test

- Prereq: `export PATH="$HOME/.bun/bin:$PATH"`; `bun install` at the root.
- Dev: `cd apps/web && bun run dev` starts Hono on `http://localhost:3000` (`bun --watch src/server/index.ts`) and Vite on `http://localhost:5173` (proxying `/api`, `/events`, `/tasks`). Open `http://localhost:5173`.
- Prod: `cd apps/web && bun run build && bun run start`; open `http://localhost:3000`.
- Data: the repo's own `.buildsmith/` at `/Users/aidenhadisi/aidengit/buildsmith/.buildsmith` (server resolves the root from cwd via `findRoot`; `BUILDSMITH_ROOT` overrides).
- Nothing external is contacted. Live-refresh checks edit a seed task's `task.md` and must revert it (`git checkout -- .buildsmith`).

## Design rulings

_Append-only. One line per critic objection._

- Drop `@hono/zod-validator` on `/api/tasks/:id` (pass-through, pulls in zod) · Adopt · id is a string; store throws → 404.
- Inline `useQuery` instead of `useBoard`/`useTask` single-caller hooks · Adopt · matches "no wrapper hooks without a second caller".
- Invalidate queries on EventSource `open` · Adopt · `bun --watch` restarts drop events; reconnect must refetch.
- `idleTimeout: 255` + 15 s ping unexplained · Adopt · ping every 5 s, no server option.
- Vite proxy `timeout: 0` for `/events` · Adopt (cut) · heartbeat resets inactivity timers.
- `realpath` in asset route · Adopt (cut) · `resolve` + `relative` check; 403 vs 404 stay distinct; symlinks not a threat locally.
- Missing `index.html` Vite entry · Adopt · added to wiring.
- `@` alias needs `resolve.alias` in Vite too · Adopt · added to wiring.
- Missing deps (react-query, react-markdown, remark-gfm, Base UI); decide on `@modelcontextprotocol/hono` · Adopt · add the four, remove MCP dep until the MCP slice exists.
- Reload config on `config.yml` change · Reject · restart is fine for v1; documented as known limit.
- Catch-all → 404 hides corrupt frontmatter · Adopt · match store's not-found message only.
- `dir` / `blocked[].file` leak absolute paths to client · Noted · localhost tool, not stripped.
- Plan still said `idleTimeout: 255` · Adopt · removed; ping alone keeps the stream alive.
- Ping loop must exit on abort or `watch` leaks · Adopt · loop on `!aborted && !closed`, unsubscribe in `onAbort`.
- Traversal proof: curl squashes `..` · Adopt · proof uses `--path-as-is`; route test uses raw path via `app.request`.
- Unknown `/api/*` falls into SPA `index.html` · Adopt · JSON 404 for `/api/*` before static.
- `./dist` cwd-relative · Adopt · `join(import.meta.dir, "../../dist")`.
- `hc` does not throw on non-2xx · Adopt · one `json()` helper throws on `!ok`.
- Send empty SSE `change` payload · Reject · `WatchEvent` JSON costs nothing and makes `curl -N` readable.
- `jsx: react-jsx` already in root tsconfig; `--filter` typecheck is required not optional · Adopt · plan corrected.

- Slice 1: no `typecheck` scripts for cli/mcp (TS18003, `--filter` skips them) · Adopt.
- Slice 1: client deps belong to the client slice · Adopt · only removals here.
- Slice 1: static/SPA serving has no criterion yet · Adopt · deferred to the build slice.
- Slice 1: seed must `tasks.move(A, "building")`; assert `column` in criterion 1 · Adopt.
- Slice 1: add `bun run check`, corrupt-frontmatter → 500 test, missing-task asset → 404, explicit edit+revert for SSE, ping on connect · Adopt.

- Slice 2: Base UI package is `@base-ui/react` (renamed v1.0) · Adopt · plan deps corrected.
- Slice 2: first-8-chars short id collides for UUIDv7 · Adopt · show last 6 hex chars of the id.
- Slice 2: shadcn init needs `index.css`, alias, `paths` first; use `init -b base` · Adopt · ordered in coder brief.
- Slice 2: `tooltip` has no caller yet · Adopt · generate in the slice that uses it.
- Slice 2: specify loading/error render · Adopt · `Board` renders `null` while loading, `error.message` on error.
- Slice 2: seed `task.md` left dirty by testing · Adopt · verify clean tree before live run.
- Slice 2: make "type-only import" observable · Adopt · `rg` check + build output contains no `hono/streaming`.
- Slice 2: no `@types/node`; use `import.meta.dirname` · Adopt.
- Slice 1 live test: Bun normalizes `/assets/../../config.yml` to `/tasks/config.yml` before routing (404); encoded `..%2F..` hits the guard (403). With an SPA fallback the normalized path would return `index.html` 200 and break the frozen 4xx check · Adopt · drop the SPA fallback entirely — the app has only `/` (+ query), so `serveStatic({ root })` alone serves `/` and `/assets/*`; everything else stays 404.
- Slice 2 live test: after a `bun --watch` restart the page stayed stale. Root cause: Vite 8.3's proxy pipes the upstream SSE body with `pipe(res, { end: true })` and skips `res.end()` once headers are sent, so a killed upstream never closes the browser stream; `EventSource` sits OPEN forever and never reconnects (verified: `curl -N :5173/events` goes silent, `:3000/events` gets `transfer closed`) · Adopt · client watchdog in `useLiveRefresh`: 15 s without `ping`/`change` → close + reconnect; `open` invalidates. Restart proof must rewrite the file (`touch` does not trigger `bun --watch`).
- Slice 2 review: watchdog may `connect()` after unmount · Reject · the timer callback runs to completion synchronously (`close` + reassign `source`), so cleanup always closes the current source; no window for a leak.
- Slice 3: `useTaskParam` via `pushState` + re-dispatched `popstate`, `useSyncExternalStore`; no emitter, no prop drilling · Adopt.
- Slice 3: `skipToken` instead of `enabled: !!id` · Adopt · narrows id for free, sheet stays mounted for exit animation.
- Slice 3: `@tailwindcss/typography` (`prose`) instead of hand-styled markdown · Adopt · one dev dep beats 20+ lines of tuning.
- Slice 3: `toLocaleString()` not `Intl.RelativeTimeFormat`; assert `image/png`; exact `write-spec` text; live blocked-slice check; `DocView` gets an optional header; `TaskCard` button `w-full text-left`; pushState on close is fine (Back reopens) · Adopt.
- Slice 3: `ScrollArea` unused → delete `scroll-area.tsx`; `overflow-y-auto` on sheet content · Adopt.
- Slice 4: "no dist → 404" test is nondeterministic once `dist/` exists · Adopt · `createApp(store, distDir)`; entry passes `join(import.meta.dirname, "../../dist")`; test uses a temp dist and asserts `/` html, `/assets/a.js` js, `/nope` 404, `/api/nope` JSON 404.
- Polish: `DocView` derives its header from `doc.kind` instead of an optional `header` prop; orphan `lib/utils.ts` deleted (shadcn CLI only needs the alias to resolve) · Adopt.
- Slice 4: `.use("*", serveStatic)` not `.get("/*")` so `AppType` gains no route; `import.meta.dirname`; root `build` + `start` scripts; static evidence is `/` and `/assets/*.js`, not the asset route · Adopt.

## Slice log

_Append-only._

- [x] **Slice 1 — Server + dogfood data** · `34de206`
  - Proven: `bun run check`/`typecheck` green, 9 route tests pass; live `curl /api/board` → 5 columns, A building/building, B backlog/spec; `/api/tasks/<A>` → spec approved rev 2, 3 slices, 3 notes; `/api/tasks/nope` 404 JSON, corrupt `task.md` → 500; `board.png` 200 `image/png`, `..%2F..%2Fconfig.yml` 403, path-as-is `..` normalized by Bun → 404; `curl -N /events` showed ping on connect, 5 s pings, and `change` for the edited `task.md`; seed reverted, tree clean.
  - Criteria:
    1. `GET /api/board` → `{ columns: [backlog, planning, building, review, done], tasks }`; task A has `column: building`, `next.stage: building`; task B has `column: backlog`, `next.stage: spec`.
    2. `GET /api/tasks/<A>` → task, next, spec + architecture (status, revision), verification, 3 slices, 3 notes; `/api/tasks/nope` and `/api/whatever` → 404 `{ error }`; corrupt `task.md` → 500, not 404.
    3. `/tasks/<A>/assets/board.png` → 200 `image/png`; `curl --path-as-is …/assets/../../config.yml` → 403; missing asset → 404; `/tasks/nope/assets/x.png` → 404.
    4. `curl -N /events` prints `event: ping` immediately and every 5 s; editing task A's `task.md` title prints `event: change` with `{"taskId","file"}`; revert with `git checkout -- .buildsmith`; closing curl logs no error.
    5. `bun test` (route tests via `app.request` on a temp store), `bun run check`, root `bun run typecheck` all pass.

- [x] **Slice 2 — Board client** · `7ebc223`
  - Proven: screenshot at :5173 shows Backlog/Planning/Building/Review/Done in order, "Web board" (e1b5d5, `building`) and "MCP server" (e2c0a8, `spec`), empty columns with count 0; disk title edit visible in 679 ms without reload; after a `bun --watch` restart the next edit showed in 3.2 s (watchdog reconnect); revert restored; one `import type` server import, dist has no `hono/streaming`; renaming `columns` fails client tsc; check/typecheck/test/build green.
  - Criteria:
    1. `bun run dev` in `apps/web` starts server + Vite; `http://localhost:5173` shows 5 columns in config order; "Web board" card in building with badge `building`, "MCP server" in backlog with badge `spec`; each card shows a distinct short id (last 6 hex chars); empty columns render heading + empty body.
    2. Editing task A's title on disk updates the card within ~1 s with no reload (then revert). After a server restart (`touch src/server/app.ts`), the next disk edit still refreshes the board.
    3. `rg 'from "\.\./server' apps/web/src/client` shows exactly one `import type` line; `vite build` output contains no `hono/streaming`. Renaming `columns` in `app.ts` fails `bun run typecheck` in the client (revert).
    4. `bun run check`, root `bun run typecheck`, `bun test`, and `bun run build` (writes `dist/`) all pass.

- [x] **Slice 3 — Task detail sheet** · `81803c3`
  - Proven: sheet opens with `?task=<A>`, survives reload, closes via Escape/X/backdrop clearing the param; Overview shows description, 8 criteria, `work-slice — slice 2 is doing`; Spec shows `approved`/`revision 2`, GFM table, 3 checkboxes, code block, image `naturalWidth 64` fetched 200 `image/png`; Slices done/doing/todo with `4b5b604`; 3 notes (`critic · spec · revise` …); Verification `pending`; MCP server shows `write-spec — spec does not exist` and all empty states; blocking slice 2 on disk showed `Blocked #2 Board client` in 0.65 s, revert cleared it in 1.9 s; sheet widened to 672 px with all six tabs visible.
  - Criteria:
    1. Clicking "Web board" opens the right-side sheet; URL becomes `?task=01a09815-35cb-7313-b058-5656c1e1b5d5`; reload reopens it; closing (X / Escape / backdrop) removes the param.
    2. Overview shows description, 8 criteria, `next` action `work-slice` with its reason; Spec tab shows `approved` + `revision 2` with a rendered GFM table, task list, code block, and the image requested from `/tasks/<A>/assets/board.png` (200, `image/png`); Architecture shows `approved`.
    3. Slices tab lists 3 slices (done/doing/todo, commit `4b5b604` on #1); Notes shows 3 entries with author · target · verdict; Verification shows "pending" and the checklist.
    4. "MCP server": Overview shows action `write-spec`, badge `spec`; Spec/Architecture/Verification/Slices/Notes show empty states.
    5. With A's sheet open, setting slice 2 `status: blocked` on disk shows it under Overview → blocked within ~1 s; revert restores.
    6. `bun run check`, root `typecheck`, `bun test`, `bun run build` pass (no new tests expected).

- [x] **Slice 4 — Production serve + repo wiring** · `33da69a`
  - Proven: `bun run start` from root → `/` 200 `text/html`, `/assets/index-*.js` 200 `text/javascript`, `/nope` 404, `/api/nope` JSON 404, path-as-is traversal 404; board and sheet render at :3000 with Spec image `naturalWidth 64`; `bun apps/web/src/server/index.ts` from root also serves `/`; 31 tests (4 new static tests on a temp dist), check/typecheck/build green; CI has the build step.
  - Criteria:
    1. `bun run build && bun run start` at the repo root → `curl -si :3000/` 200 `text/html`; `/assets/<hash>.js` 200 `text/javascript`; browser at :3000 renders the board, opens a sheet, Spec image loads; `/nope` → 404; `/api/nope` → JSON 404; `--path-as-is /tasks/<A>/assets/../../config.yml` → 4xx.
    2. From the repo root, `bun apps/web/src/server/index.ts` also serves `/` (dist path independent of cwd).
    3. New static route tests pass against a temp dist; `bun run check`, `typecheck`, `test`, `build` pass; CI has a build step; README and `.buildsmith/project.md` document dev/prod commands and `BUILDSMITH_ROOT`.
