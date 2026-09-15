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

The package is still `private`. When publishing starts, versions bump with `bun run release` (bumpp) from a clean `main`.
