# Board command and single-binary release

## What we're building

Today the board is `apps/web`: a Vite SPA plus a Hono server started with `bun run start` from the
buildsmith checkout, pointed at another repo through `BUILDSMITH_ROOT`. Users have to know where
buildsmith is cloned and set an env var. The CLI already knows how to find `.buildsmith/` from the
cwd for every other command.

We move the board into the CLI package and add `buildsmith board`: find the board for the current
repo, serve it on localhost, open the browser, run until Ctrl-C. The CLI package carries the built
SPA, so this works via `bun link` today and via npm later. A release workflow compiles `buildsmith`
into one executable per platform (Bun embeds `dist/`, `prompts/`, `plugin/`), so users who are not
Bun users can download a binary. Done means: `cd any-repo && buildsmith board` opens that repo's
board, and a pushed `v*` tag produces five binaries on a GitHub Release.

## Requirements

- `buildsmith board` finds `.buildsmith/` by walking up from the cwd, like every other command.
- Binds `127.0.0.1`; default port 3000, `--port <n>` to choose, falls back to a free port when the
  chosen one is taken; prints the URL it bound.
- Opens the default browser on that URL; `--no-open` skips it. Never fails because a browser is
  unavailable.
- Runs in the foreground; Ctrl-C stops the server cleanly.
- No `.buildsmith/`: exit 1 with one line that names `buildsmith init`.
- Source mode with no built SPA: exit 1 with one line that names `bun run build`.
- Prompt templates, the plugin, and the SPA all resolve from one package root that is correct in
  source mode and in a compiled binary.
- `{{cli}}` in briefs renders as the binary path when compiled, `bun <main.ts>` otherwise.
- `bun run dev` (Vite HMR + watched server), `bun run build`, `check`, `typecheck`, `test` keep
  working after the move.
- `bun run build:bin` compiles a binary for the host platform; a release workflow on `v*` tags
  compiles darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64 and attaches them to a
  GitHub Release (prerelease when the tag has a `-` suffix).

## Out of scope

- Publishing to npm (user: not until fully ready).
- `install.sh` / Homebrew formula — follows once binaries exist.
- `board --detach` / daemon mode.
- SPA client-side routes — the board uses `?task=` query params, no fallback needed.
- `packages/mcp` — an empty stub, untouched.

## Acceptance criteria

- [ ] Board for the current repo — proof: `cd /tmp/bs-demo && buildsmith board --no-open` prints
      `http://127.0.0.1:3000`; `curl /api/board` lists that repo's 6 tasks; `curl /` returns the
      SPA `index.html`; Ctrl-C exits 0.
- [ ] Opens the browser — proof: without `--no-open`, the board tab appears (screenshot) and the
      command stays in the foreground.
- [ ] Port fallback — proof: with 3000 held by another process, `buildsmith board --no-open` prints
      a different port and serves there; `--port 4100` binds exactly 4100.
- [ ] Clear errors — proof: in a dir with no `.buildsmith/` up the tree: exit 1, stderr names
      `buildsmith init`. With `packages/cli/dist` removed: exit 1, stderr names `bun run build`.
- [ ] Dev flow intact — proof: `bun run dev` serves Vite on 5173 proxying to the board server;
      `bun run build && bun run check && bun run typecheck && bun test` all green.
- [ ] Single binary — proof: `bun run build:bin` writes `release/buildsmith-<os>-<arch>`; from
      `/tmp/bs-demo` with Bun removed from `PATH`, `./buildsmith board --no-open --port 0` serves
      `/api/board` and the embedded `index.html` + a hashed asset; `./buildsmith brief <id>`
      renders `{{cli}}` as the binary path; `./buildsmith prompt list` and
      `./buildsmith setup cursor --dry-run` work.
- [ ] Release workflow — proof: push tag `v0.1.0-rc.1`; the GitHub Release has five binaries;
      the darwin-arm64 asset downloads and runs `--version`. Tag and release deleted after.

## Architecture

_Filled in step 3._

## Conventions

- citty command: default-export `defineCommand({ meta, args, run })` in `src/commands/<name>.ts`,
  registered in `src/main.ts` `subCommands` — exemplar: `packages/cli/src/commands/next.ts`
- Errors go through `guard`/`act` in `src/io.ts`: throw `Error`, never `process.exit`; one line on
  stderr, `exitCode = 1` — exemplar: `packages/cli/src/commands/setup.ts`
- CLI tests spawn `bun src/main.ts` in a `mkdtemp` repo and assert stdout/stderr/exit —
  exemplar: `packages/cli/src/cli.test.ts` `run()`
- Web server tests are in-process `app.request()` with a temp dist — exemplar:
  `apps/web/src/server/app.test.ts`
- Sidecar assets resolve from `import.meta.dir` — exemplar: `packages/cli/src/prompts.ts`
- `.ts`/`.tsx` import extensions, `import type`, oxfmt defaults (double quotes, semicolons, 100).

## Verification

- `bun run check` (oxlint + oxfmt)
- `bun run typecheck`
- `bun run build`
- `bun test`

## Live test

- Demo board with a full critique loop: `/tmp/bs-demo` (6 tasks, seeded earlier). Empty dir for the
  no-root case: `mktemp -d`.
- Source mode: `cd /tmp/bs-demo && buildsmith board --no-open` (`buildsmith` is `bun link`ed to
  `packages/cli/src/main.ts`). Verify with `curl -s localhost:3000/api/board | jq '.tasks|length'`
  and `curl -s localhost:3000/ | head -3`.
- Dev mode: `bun run dev` from the checkout, http://localhost:5173.
- Binary: `bun run build:bin`, then `env PATH=/usr/bin:/bin ./release/buildsmith-darwin-arm64 board
  --no-open --port 0` from `/tmp/bs-demo`.
- Nothing here leaves the machine except the release tag push in the last criterion.

## Design rulings

## Slice log
