# Contributing

## Setup

Install [Bun](https://bun.sh) 1.4.2+, then:

```sh
bun install
```

## Checks

```sh
bun run check
bun test
```

Format:

```sh
bun run fmt
```

## Pull requests

Open against `main`. Keep changes small. Do not commit `node_modules`, build output, or secrets.

## Releases

Releases are cut from a clean `main` with `bun run release` (bumpp). It bumps the version, tags `v<version>`, and pushes; the Release workflow then attaches compiled binaries to a GitHub Release and publishes to npm.
