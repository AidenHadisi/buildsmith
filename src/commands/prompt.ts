import { findRoot } from "../store/index.ts";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { promptsDir } from "../paths.ts";
import { repoPath, resolve, templates } from "../prompts.ts";

const list = defineCommand({
  meta: { name: "list", description: "List prompt templates and where each resolves from" },
  run: async () => {
    const root = findRoot();
    return Promise.all(
      (await templates()).map(async (action) => ({
        action,
        source: (await resolve(root, action)).source,
      })),
    );
  },
});

const show = defineCommand({
  meta: { name: "show", description: "Print the resolved template for an action" },
  args: {
    action: { type: "positional", description: "Action name", required: true },
  },
  run: async ({ args }) => {
    const { source, path } = await resolve(findRoot(), args.action);
    const text = await Bun.file(path).text();
    return { action: args.action, source, path, text };
  },
});

const eject = defineCommand({
  meta: { name: "eject", description: "Copy a built-in template into .buildsmith/prompts" },
  args: {
    action: { type: "positional", description: "Action name", required: true },
  },
  run: async ({ args }) => {
    const root = findRoot();
    const { source, path } = await resolve(root, args.action);
    if (source === "repo") throw new Error(`already ejected: ${path}`);
    const dest = repoPath(root, args.action);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(path, dest);
    return { action: args.action, path: dest };
  },
});

const diff = defineCommand({
  meta: { name: "diff", description: "Diff the repo override against the built-in template" },
  args: {
    action: { type: "positional", description: "Action name", required: true },
  },
  run: async ({ args }) => {
    const { source, path } = await resolve(findRoot(), args.action);
    if (source === "built-in") return `no override for ${args.action}`;
    const proc = Bun.spawn(["diff", "-u", join(promptsDir, `${args.action}.md`), path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    // diff exits 1 when the files differ; only 2+ is a failure
    if (code > 1) throw new Error(stderr.trim() || `diff failed for ${args.action}`);
    return stdout;
  },
});

export default defineCommand({
  meta: { name: "prompt", description: "List, show, eject, and diff prompt templates" },
  subCommands: { list, show, eject, diff },
});
