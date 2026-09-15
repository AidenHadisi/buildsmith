## Run

- `bun install`
- Dev: `bun run dev` — Vite on http://localhost:5173 (proxies to Hono on :3000)
- Prod: `bun run build` — writes the SPA to `packages/cli/dist`

## Check

- `bun run check` — oxlint + oxfmt
- `bun run typecheck` — every workspace's `tsc --noEmit`
- `bun test`

## Live test

- Dev: `bun run dev`, open http://localhost:5173 (Vite proxies `/api`, `/events`, `/tasks` to :3000)
- Prod: `bun run build` writes `packages/cli/dist`
- Data: the repo's own `.buildsmith/`, resolved from the cwd

## Environment

- Local only; no external services.

## Data safety

- Edits stay under `.buildsmith/`; revert with `git checkout -- .buildsmith`.

## Lessons

- Bun's URL parser normalizes `..` before routing; traversal guards must be tested with encoded segments (`%2F`).
