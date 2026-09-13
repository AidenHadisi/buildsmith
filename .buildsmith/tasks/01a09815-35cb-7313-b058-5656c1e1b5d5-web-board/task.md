---
id: 01a09815-35cb-7313-b058-5656c1e1b5d5
title: Web board
column: building
order: a0
createdAt: 2026-09-13T00:05:21.995Z
updatedAt: 2026-09-13T00:05:21.999Z
branch: feat/web-board
---

A read-only Kanban board over this repo's `.buildsmith/` folder. A Vite SPA (React 19, Tailwind 4, shadcn on Base UI, TanStack Query) talks to a small Hono server on Bun that wraps `@buildsmith/store`. Columns come from `config.yml`, each card opens a side sheet with the task's docs, and SSE pushes file changes to the page as the agent edits them.

## Acceptance criteria

- Board renders from config
- Card detail sheet
- Markdown + assets
- Pipeline state visible
- Live refresh
- Typed API
- Green checks
- Dogfood data
