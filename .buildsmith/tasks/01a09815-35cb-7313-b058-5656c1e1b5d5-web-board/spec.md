---
status: approved
revision: 2
---

## Overview

A read-only Kanban board over a repo's `.buildsmith/` folder. A Vite SPA (React 19, Tailwind 4, shadcn on Base UI, TanStack Query) talks to a small Hono server on Bun that wraps `@buildsmith/store`. The server pushes `store.watch()` events over SSE so the page refreshes as the agent edits files.

## Requirements

| Area         | Choice                                 |
| ------------ | -------------------------------------- |
| Client       | React 19 + TanStack Query, no router   |
| Server       | Hono on Bun, port 3000                 |
| Data         | `.buildsmith/` via `@buildsmith/store` |
| Live updates | SSE invalidation, not a data channel   |

- One column per `config.yml` column, in order; cards show title, short id, and stage.
- Clicking a card opens a side sheet; `?task=<id>` in the URL reopens it on reload.
- Sheet tabs: Overview, Spec, Architecture, Slices, Notes, Verification.
- Markdown rendered with GFM; relative `assets/...` image links resolve to the server's asset route.

## Shared types

Client and server share route types through Hono RPC; no hand-written fetch URLs:

```ts
import { hc } from "hono/client";
import type { AppType } from "../server/app.ts";

export const api = hc<AppType>("/");
```

## Milestones

- [x] Server + dogfood data
- [ ] Board client
- [ ] Task detail sheet

![Board mockup](assets/board.png)

## Out of scope

- Editing, drag-and-drop, creating tasks — v1 is read-only; the agent manages the board via MCP later.
- Auth — local tool on localhost.
- Syntax highlighting in code blocks — plain `<pre>` for now.
