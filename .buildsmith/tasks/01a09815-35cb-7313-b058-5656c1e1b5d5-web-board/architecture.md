---
status: approved
revision: 1
---

## Overview

Three components, one-way dependencies: client → server → store. The client never imports store runtime code; it sees the server only through Hono RPC types.

## Server — `apps/web/src/server/`

Owns: turning the store into HTTP. One Hono app, routes chained so `AppType` is inferable.

- `GET /api/board` → columns plus tasks with `next` per task.
- `GET /api/tasks/:id` → task, next, docs, slices, notes; the store's not-found maps to 404, anything else is a 500.
- `GET /events` → SSE: `change` on `store.watch()`, `ping` every 5 s; `onAbort` unsubscribes the watcher.
- `GET /tasks/:id/assets/*` → `resolve` + `relative` guard; 403 and 404 stay distinct.
- SPA fallback: `serveStatic` from `dist/` registered last.

## Client — `apps/web/src/client/`

Owns: rendering board state; nothing else.

- `api.ts` — `hc<AppType>("/")` plus one `json(res)` helper that throws on `!res.ok`.
- `useLiveRefresh()` — one `EventSource("/events")`; invalidate on `change` and on `open`.
- `useTaskParam()` — reads/writes `?task=` with `URLSearchParams` + `popstate`.
- Components: `Board`, `TaskCard`, `TaskSheet`, `DocView`, `SliceList`, `NoteList`, `Markdown`.

## Dogfood data — `.buildsmith/`

The seed the dev server shows: default columns, a real `project.md`, and two tasks — this one exercising every tab, and `MCP server` in backlog with only `task.md`.

## Key decisions

- Separate Hono process, not a Vite plugin: same code path in dev and prod.
- SSE is a cache-invalidation signal, not a data channel — the client keeps one fetch path.
- No router, no global state library: `?task=` + TanStack Query is the whole state.
