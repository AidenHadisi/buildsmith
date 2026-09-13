## Run

- `bun install`
- `bun run dev` — Hono on http://localhost:3000 and Vite on http://localhost:5173

## Check

- `bun run check` — oxlint + oxfmt
- `bun run typecheck` — every workspace's `tsc --noEmit`
- `bun test`

## Live test

- Dev: `cd apps/web && bun run dev`, open http://localhost:5173 (Vite proxies `/api`, `/events`, `/tasks` to :3000)
- Prod: `cd apps/web && bun run build && bun run start`, open http://localhost:3000
- Data: the repo's own `.buildsmith/`; `BUILDSMITH_ROOT` overrides the cwd lookup

## Environment

- Local only; no external services.

## Data safety

- Edits stay under `.buildsmith/`; revert with `git checkout -- .buildsmith`.

## Lessons

- Bun's URL parser normalizes `..` before routing; traversal guards must be tested with encoded segments (`%2F`).
