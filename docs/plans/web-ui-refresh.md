# Web UI refresh

## What we're building

The Buildsmith web board is a read-only Kanban over `.buildsmith/`. It already sits on React 19, Vite, Tailwind 4, and shadcn Base UI, but it still looks like a default kit: no chrome, blank loading, sparse cards, and a tabbed document dump instead of a pipeline.

This refresh keeps those contracts and that stack. It adds a product header with the frozen anvil-and-ember icon, richer cards, designed loading/empty/error states, a sheet that leads with “what happens next,” and a restrained light+dark visual system driven by `prefers-color-scheme`.

Done looks like a local operator UI a developer can scan: identity, live connection, next action on every card, and a sheet that explains the pipeline — still watch-only.

## Requirements

- Product chrome: top bar with the frozen anvil icon, the name Buildsmith, and a live/stale SSE chip.
- Favicon and header mark use `docs/plans/assets/buildsmith-icon.png` (refined flat anvil + diamond ember on dark tile).
- Cards keep title, last-6 id, and pipeline stage; also show `next.action` and, when present on the board payload, blocked and slice progress.
- Task sheet leads with next action/reason and a visible spec → architecture → slices → verify path; the six existing tabs still reach every current document.
- First load is skeletons; API failure is a designed error; empty columns still render and say they are empty.
- Light and dark both look intentional. `prefers-color-scheme` applies `.dark`. Status color comes from tokens, not a one-off `green-600`.
- Hover and keyboard focus are visible on cards.
- Stay read-only: no create/edit/move. `?task=` deep link, Back to reopen the sheet, and SSE live updates still work.

## Out of scope

- Editing, drag-and-drop, task creation — v1 is watch-only; store mutations stay off HTTP.
- Command palette, new router, extra routes — `?task=` is enough.
- Syntax highlighting — frozen by `docs/plans/web-board.md`.
- Swapping shadcn/Base UI, adding Untitled UI or another kit.
- MCP or CLI UI.
- Density toggle, theme toggle in the chrome (system preference only).
- Changing store schemas or board API shape unless a card field is already on the payload.

## Acceptance criteria

- [ ] **Chrome** — At http://localhost:5173 the board shows a top bar with the anvil icon, the product name, and a live/stale connection chip (SSE up vs reconnecting). It is not a headerless column row.
- [ ] **Cards** — Each card still shows title, last-6 id, and pipeline stage. It also shows the next action and, when the payload has them, blocked and slice progress. Hover and keyboard focus are visible. Seed: “Web board” in Building, “MCP server” in Backlog.
- [ ] **Sheet as pipeline** — Opening Web board (`?task=01a09815-35cb-7313-b058-5656c1e1b5d5`) leads with next action/reason and a visible spec → architecture → slices → verify path. The six existing tabs still reach every current document. MCP server’s empty tabs still have empty copy, not a blank panel.
- [ ] **States** — First load is skeletons, not a white page. API failure is a designed error, not raw `<p>{message}</p>`. Empty columns still render and say they’re empty.
- [ ] **Theme** — Light and dark both look intentional. Switching OS appearance (or `.dark` on `html`) restyles board, cards, sheet, and markdown. Status color comes from tokens, not a one-off `green-600`. Favicon is the frozen anvil icon.
- [ ] **Read-only contract** — No create/edit/move controls. Deep link, Back to reopen the sheet, and live disk updates via SSE still work. `bun test`, `bun run typecheck`, and `bun run check` stay green.

## Architecture

Jobs: apply system light/dark before first paint; own visual tokens; render chrome; expose SSE liveness; columns with loading/error/empty; richer cards; pipeline status on sheet tabs; serve a real PNG favicon.

**Visual tokens** (`apps/web/src/client/index.css`) owns the semantic palette, surface steps, and three status tokens (`--success`, `--warning`, `--info` plus foregrounds) wired through `@theme inline`. Also set `color-scheme: light` on `:root` and `color-scheme: dark` on `.dark`. Everything else consumes utilities. One place to reskin.

**Theme sync** is an inline `<script>` in `apps/web/index.html` (not a React module): `matchMedia("(prefers-color-scheme: dark)")` toggles `html.dark` on load and on `change`. Runs before CSS paints. Board does not touch the document.

**Live refresh** (`useLiveRefresh.ts`) keeps EventSource + query invalidation and returns `{ live: boolean }`. `live` is true on `open` / `ping` / `change`, false when the watchdog fires or on `error`. Do not use `EventSource.readyState` (Vite proxy leaves it OPEN after upstream death). Chrome reads the boolean. No second socket. 15s watchdog lag after death is accepted.

**Board** (`Board.tsx`) owns the page: header (icon, name, live/stale chip using success/destructive tokens), column layout, five ghost-column skeletons on first load (config columns unknown until the fetch returns), error panel with a `refetch()` Retry, empty-column copy, and mounting `TaskSheet`. Error panel only when `!data` (keep the board if a background refetch fails; the stale chip carries that signal). First-load skeletons are inline `animate-pulse` divs, not a generated Skeleton primitive. Do not extract Header/Column/Skeleton unless a second caller appears.

**Task card** (`TaskCard.tsx`) owns one row: title, last-6 id, stage, `next.action`, and a blocked count when `task.next.blocked?.length`. Board payload has no slices — do not add them to `/api/board`.

**Stage badge** (`StageBadge.tsx`) maps stages onto the three semantic tokens (spec/architecture → info, slicing/building → warning, verify → info outline, done → success). No `green-600`.

**Task sheet** (`TaskSheet.tsx`) owns the overlay. A local `pipelineSteps(detail)` helper (same file; one caller) returns status for spec / architecture / slices / verification plus `current` from `next.stage`. Those four `TabsTrigger`s show a small mark/count; Notes does not. Overview leads with Next (action, reason, blocked) above the description. Six tabs stay; empty copy stays. Do not add a separate stepper. While the task query has no data, show inline pulse lines and keep `SheetTitle` mounted; on fetch error with no data, the same designed error block as Board (not raw `error.message`).

**Icon asset** — re-encode the frozen artwork to a real 256px PNG (`sips -s format png -Z 256 docs/plans/assets/buildsmith-icon.png --out apps/web/public/icon.png`). `index.html` favicon and the header `img` use that file. Wrap the header image in `rounded-md` so the baked dark tile sits cleanly in both themes. Not a React component.

Seams (one-way): tokens → all views; inline script → `html` class; `useLiveRefresh` → Board chip + QueryClient; `BoardTask` → TaskCard; `TaskDetail` → TaskSheet; `?task=` hook unchanged.

Contain what is likely to change: token values, and how much of `next` the card shows. No theme provider, router, or store import.

## Conventions

- Client-only change unless a board field is already missing from the JSON — exemplar: `apps/web/src/client/Board.tsx`
- ESM imports with `.ts`/`.tsx` extensions; `import type`; no enums — exemplar: `apps/web/src/client/api.ts`
- App files use raw `className` strings; `cn()` stays inside generated `components/ui/*` — exemplar: `apps/web/src/client/TaskCard.tsx`
- Leave `components/ui/*` as generated; add a shadcn primitive only when a real caller exists (Skeleton, Tooltip) — exemplar: `apps/web/src/client/components/ui/badge.tsx`
- No `"use client"` in app files; no `lib/utils.ts`; no barrels; no single-caller wrapper hooks — exemplar: `docs/plans/web-board.md`
- Cards show last **6** hex chars of id; sheet tabs stay Overview, Spec, Architecture, Slices, Notes, Verification — exemplar: `apps/web/src/client/TaskSheet.tsx`
- Client never imports store runtime; Hono RPC types only — exemplar: `apps/web/src/client/api.ts`
- oxfmt: double quotes, semicolons, width 100 — run `bun run fmt`

## Verification

- `bun test`
- `bun run typecheck`
- `bun run check`

## Live test

- Start: from repo root, `bun run dev`
- UI: http://localhost:5173 (Vite; proxies `/api`, `/events`, `/tasks` to :3000)
- API health: `curl -s http://localhost:3000/api/board` — 200 JSON with columns and two seed tasks
- Data: committed `.buildsmith/` (no auth). Web board id `01a09815-35cb-7313-b058-5656c1e1b5d5` in Building; MCP server in Backlog
- Deep link: http://localhost:5173/?task=01a09815-35cb-7313-b058-5656c1e1b5d5
- Outbound: none. Do not hit the shadcn registry during tests. Revert any seed edits with `git checkout -- .buildsmith`

## Design rulings

- Theme sync in a React module next to main.tsx · Adopt · Move to inline script in index.html so dark users never flash light; add color-scheme on :root/.dark.
- Separate Overview stepper duplicating Spec/Architecture/Slices/Verify tabs · Adopt · Put pipeline marks on those four TabsTriggers; Overview only leads with Next.
- Slice progress on cards · Adopt · Board payload has no slices; cards show blocked count only; do not widen the API.
- Six per-stage color tokens · Adopt · Three semantic tokens (success/warning/info) reused by badge, chip, and blocked mark.
- Copy the 84KB mislabeled JPEG as favicon · Adopt · Re-encode to 256px real PNG; wrap header img in rounded-md.
- live from EventSource.readyState · Reject · Vite proxy leaves readyState OPEN; watchdog-based boolean is the truthful signal.
- ThemeProvider / useTheme · Reject · No toggle; would still flash; inline script is enough.
- Extract Header/Column/Skeleton from Board · Reject · One caller each; Board stays the page.
- Add slices to GET /api/board · Reject · Out of scope API change.
- CSS-only dark (media query, no .dark class) · Reject · Frozen criterion names `.dark` on html.
- Halve WATCHDOG_MS · Reject · 15s lag after death is accepted; do not retune the existing watchdog in this refresh.
- Retry on board error · Adopt · refetch() is read-only, not create/edit/move.
- First-load skeleton column count · Adopt · Five ghost columns until /api/board returns.
- Error panel whenever useQuery.error is set · Adopt · Full-page error only when `!data`; populated board stays up across transient refetch failures.
- Sheet loading/error unspecified · Adopt · Same pulse/error patterns as Board, with SheetTitle always present.
- Generate shadcn Skeleton · Reject · Inline animate-pulse divs; a one-line generated file is extra surface.
- Memoize live chip against ping re-renders · Reject · setLive(true) on identical state is a no-op; no ref/memo.
- Slice 1 retune existing surface tokens · Adopt · Additive only this slice: three status tokens + color-scheme; retune surfaces when chrome exists.
- sips --out without public dir · Adopt · mkdir -p apps/web/public first.
- Theme script type/placement unspecified · Adopt · Plain (non-module) script, first child of head.

## Slice log

- [x] **Slice 1 — Visual foundation** · pending
  - Criteria: (1) With OS dark, first paint of http://localhost:5173 has class "dark" on html from the inline head script. (2) :root/.dark define --success/--warning/--info (+ foregrounds) and color-scheme; @theme inline maps them. (3) GET /icon.png is image/png; favicon link present. (4) Board still shows five columns and seed tasks Web board + MCP server.
  - Proven: `bun test` 35 pass; `bun run typecheck` pass; `bun run check` pass. GET / served the inline matchMedia script; Chromium emulate dark → `html.dark` and `color-scheme:dark`, emulate light → class cleared. GET /icon.png `Content-Type: image/png` 256×256. GET /api/board five columns + Web board + MCP server. Vite dev prepends HMR module scripts before the inline script; class wiring still holds.
