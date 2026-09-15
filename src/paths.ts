import { join } from "node:path";

// In a compiled binary every module is bundled into /$bunfs/root/ and `--asset ./dist ./prompts
// ./plugin` (see build:bin) puts those dirs beside it. In source mode this file lives in src/, one
// level below the package root. The basenames here must match the --asset names.
export const pkgRoot = Bun.isStandaloneExecutable ? import.meta.dir : join(import.meta.dir, "..");
export const promptsDir = join(pkgRoot, "prompts");
export const pluginDir = join(pkgRoot, "plugin");
export const distDir = join(pkgRoot, "dist");
