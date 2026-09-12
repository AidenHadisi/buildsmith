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

## License

[MIT](LICENSE) © Aiden Hadisi
