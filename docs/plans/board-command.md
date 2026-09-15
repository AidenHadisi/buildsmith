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

Jobs: (1) build and ship the SPA with the CLI, (2) resolve sidecar assets in source and compiled
mode, (3) serve the board for the cwd's repo, (4) compile and release binaries.

**Components**

- **`packages/cli/web/`** — the Vite SPA and the Hono server, moved verbatim from `apps/web`
  (`index.html`, `vite.config.ts`, `public/`, `src/client/**`, `src/server/app.ts` + test). Its own
  `tsconfig.json` (DOM lib, `@` alias) so the CLI's tsconfig stays Bun-only. Vite `outDir` is
  `packages/cli/dist`. `apps/web` and `@buildsmith/web` disappear; the CLI's `typecheck` runs both
  tsconfigs. Hides: how the board is built.
- **`src/paths.ts`** — one constant, `pkgRoot`: `import.meta.dir` when
  `Bun.isStandaloneExecutable` (everything is bundled to `/$bunfs/root/`), else the package
  directory. Exports `promptsDir`, `pluginDir`, `distDir`. `prompts.ts`, `setup.ts`, `brief.ts`
  read from here instead of their own `import.meta.dir` math. `brief.ts`'s `cli` becomes
  `Bun.isStandaloneExecutable ? process.execPath : \`bun ${Bun.main}\``. Hides: where the binary
  keeps its files.
- **`src/commands/board.ts`** — `defineCommand` with `--port` (default 3000) and `--no-open`.
  Opens the store from cwd (`act`), checks `distDir/index.html` exists (else throws naming
  `bun run build`), `createApp(store, distDir)`, `Bun.serve({ hostname: "127.0.0.1", port })`
  falling back to `port: 0` on `EADDRINUSE`, prints `server.url`, spawns the platform opener
  (`open` / `xdg-open` / `cmd /c start ""`) with stdio ignored, stays alive until SIGINT then
  `server.stop()`. `io.ts` `act` appends "run `buildsmith init`" to the store's no-root error so
  every command benefits. Hides: serving and lifecycle.
- **Build + release** — CLI scripts: `dev` (Vite + `bun --watch src/main.ts board --no-open`),
  `build` (`vite build`), `build:bin` (`bun build --compile --asset ./dist --asset ./prompts
--asset ./plugin src/main.ts --outfile ../../release/buildsmith-<target>`). Root scripts point
  at the CLI; `start` becomes `buildsmith board`. `.github/workflows/release.yml` on `v*`: build
  the SPA once, cross-compile the five targets, `softprops/action-gh-release` (prerelease if tag
  has `-`). Hides: target matrix.

**Seams**

- `board.ts` → `web/src/server/app.ts`: `createApp(store, distDir)` — unchanged signature.
- `board.ts`, `prompts.ts`, `setup.ts`, `brief.ts` → `paths.ts`: read-only path constants.
- `build:bin` → `paths.ts`: the `--asset` basenames (`dist`, `prompts`, `plugin`) are the names
  `paths.ts` joins onto `pkgRoot`. Same names in both places, documented in `paths.ts`.

**Key decisions**

- Move, don't copy: one package owns build and serve, so nothing can drift between them.
- `hono/bun` `serveStatic` stays; it reads with `Bun.file`, which works on `/$bunfs/`. If the live
  test shows otherwise, swap for a ten-line `Bun.file` handler in `app.ts` — not pre-emptively.
- Port fallback via catch-and-retry on `EADDRINUSE`, not a port scanner.
- Browser opener is a spawn, not a dependency.
- No `BUILDSMITH_ROOT` any more: cwd is the contract, like every other command.

**Critic fixes (adopted)**

- `/events` is a long-lived SSE stream, so `server.stop()` would hang with a tab open: `run`
  awaits `process.once("SIGINT")`, then `server.stop(true)` and returns normally so exit is 0.
- Opener spawn wrapped in try/catch (ENOENT is synchronous).
- Vite `build.emptyOutDir: true` since `outDir` is outside the Vite root.
- `board.ts` takes the dist dir from `BUILDSMITH_DIST` when set (tests only) so both the happy path
  and the "not built" path are testable without a real build.
- Web deps land in the CLI's `devDependencies`; only `hono` is runtime.
- Windows outfile gets `.exe`.

## Slices

1. **Move the board into the CLI** — `apps/web` → `packages/cli/web`, tsconfigs, Vite outDir,
   scripts, CI; `bun run dev|build|check|typecheck|test` green.
2. **`buildsmith board`** — `paths.ts`, the command, port fallback, opener, SIGINT, error hints,
   `{{cli}}`; CLI tests; docs.
3. **Binaries and release** — `build:bin`, `release.yml`, `.gitignore`, README install section;
   prove the compiled binary and the tag workflow.

## Conventions

- citty command: default-export `defineCommand({ meta, args, run })` in `src/commands/<name>.ts`,
  registered in `src/main.ts` `subCommands` — exemplar: `packages/cli/src/commands/next.ts`
- Errors go through `guard`/`act` in `src/io.ts`: throw `Error`, never `process.exit`; one line on
  stderr, `exitCode = 1` — exemplar: `packages/cli/src/commands/setup.ts`
- CLI tests spawn `bun src/main.ts` in a `mkdtemp` repo and assert stdout/stderr/exit —
  exemplar: `packages/cli/src/cli.test.ts` `run()`
- Web server tests are in-process `app.request()` with a temp dist — exemplar:
  `packages/cli/web/src/server/app.test.ts`
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

- Slice 1: `apps/web` → `packages/cli/web`; `@buildsmith/web` and the standalone
  `src/server/index.ts` entry are gone. The CLI's `dev` script runs Vite only for now; slice 2 adds
  the `bun --watch src/main.ts board --no-open` half once the command exists.
- Slice 2: `buildsmith board` (port fallback, opener, SIGINT/SIGTERM, `BUILDSMITH_DIST` test hook),
  `src/paths.ts` for prompts/plugin/dist, `{{cli}}` binary-aware, `no .buildsmith` hint in `io.ts`,
  `dev` runs Vite + watched server via `bun run --parallel`, root `start`.
