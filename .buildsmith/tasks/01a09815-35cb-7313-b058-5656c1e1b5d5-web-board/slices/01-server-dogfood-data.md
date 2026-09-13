---
title: Server + dogfood data
status: done
commit: 4b5b604
---

Hono server wrapping the store, plus this repo's own `.buildsmith/` as committed seed data.

## Criteria

- API routes return board and task JSON
- Assets served with a traversal guard
- SSE stream emits change events and heartbeats
