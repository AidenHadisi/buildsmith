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
