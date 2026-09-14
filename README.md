# Buildsmith

Agentic coding pipeline with a local task board, a markdown-backed store, and MCP tools.

**Status:** pre-release. Not published to npm yet. APIs and file formats will change.

## Layout

```
apps/web          Local task board (React + Vite + Hono)
packages/store    Markdown + YAML store (source of truth)
packages/mcp      MCP server
packages/cli      Terminal CLI
```

State in a target repo lives under `.buildsmith/`. The UI, MCP server, and CLI all read and write that folder through `@buildsmith/store`.

```
.buildsmith/
  config.yml                 # board columns, default verify command
  project.md                 # how to run, check, live-test, and lessons
  tasks/<uuid>-<slug>/
    task.md                  # title, column, order, description, criteria
    spec.md
    architecture.md
    verification.md
    slices/01-<slug>.md
    notes.md
    assets/
```

A task's pipeline stage is derived from those files: spec and architecture move `draft → critiqued → reviewed → approved`, then slices, then a verification pass. `next()` returns the first unmet step.

## Requirements

- [Bun](https://bun.sh) 1.4.2 or later

## Scripts

```sh
bun install
bun run dev          # web UI
bun run check        # lint + format check
bun test
```

## Web board

```sh
bun run dev                    # http://localhost:5173 (Vite proxies to Hono on :3000)
bun run build && bun run start # production: http://localhost:3000
```

The server finds `.buildsmith/` by walking up from the cwd; set `BUILDSMITH_ROOT=<dir>` to override.

## CLI

```sh
bunx buildsmith --help                 # bun install links node_modules/.bin/buildsmith
bunx buildsmith task list | jq         # JSON when piped or with --json, text in a TTY
bunx buildsmith doc write <id> spec --file spec.md   # or pipe the body on stdin
```

`<id>` is a task UUID or any unique prefix/suffix of one. Outside the monorepo, run `bun packages/cli/src/main.ts`.

## Plugin

An orchestrator skill (`buildsmith`) plus two shim agents (`buildsmith-worker`, `buildsmith-reader`)
for Cursor, Claude Code, and Codex. Subagents never see the loop; they run `buildsmith brief <id>`
and follow it.

```sh
bunx buildsmith setup [cursor|claude|codex]   # default: all three; --dry-run prints, touches nothing
```

If `claude` or `codex` is not on `PATH`, setup prints the plugin commands to run by hand.

Customize prompts with `buildsmith prompt list|show|eject|diff`. A file at
`.buildsmith/prompts/<action>.md` replaces the built-in template; `<action>.extra.md` fills
`{{extra}}` without ejecting.

The loop: `next` names the due action; `brief` renders that action's template. The main agent
writes the spec and architecture with you and rules on critiques (Adopt/Reject, recorded as notes);
every other role runs as a fresh subagent that follows its brief and records the result through
the CLI. A `better-design` note sends a doc back for rewrite until a critic holds. Humans gate only
at `approve-spec` and `approve-architecture`.

## License

[MIT](LICENSE) © Aiden Hadisi
