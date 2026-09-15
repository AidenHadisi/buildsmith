import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { act } from "../io.ts";
import { promptsDir } from "../paths.ts";
import { actions, repoPath, resolve } from "../prompts.ts";

const list = defineCommand({
  meta: { name: "list", description: "List prompt templates and where each resolves from" },
  run: act(async (store) =>
    Promise.all(
      (await actions()).map(async (action) => ({
        action,
        source: (await resolve(store.root, action)).source,
      })),
    ),
  ),
});

const show = defineCommand({
  meta: { name: "show", description: "Print the resolved template for an action" },
  args: {
    action: { type: "positional", description: "Action name", required: true },
    json: { type: "boolean", description: "Return { action, source, path, text }" },
  },
  run: act(async (store, args) => {
    const { source, path } = await resolve(store.root, args.action);
    const text = await Bun.file(path).text();
    if (args.json) return { action: args.action, source, path, text };
    console.log(text);
  }),
});

const eject = defineCommand({
  meta: { name: "eject", description: "Copy a built-in template into .buildsmith/prompts" },
  args: {
    action: { type: "positional", description: "Action name", required: true },
  },
  run: act(async (store, args) => {
    const { source, path } = await resolve(store.root, args.action);
    if (source === "repo") throw new Error(`already ejected: ${path}`);
    const dest = repoPath(store.root, args.action);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(path, dest);
    return { action: args.action, path: dest };
  }),
});

const diff = defineCommand({
  meta: { name: "diff", description: "Diff the repo override against the built-in template" },
  args: {
    action: { type: "positional", description: "Action name", required: true },
  },
  run: act(async (store, args) => {
    const { source, path } = await resolve(store.root, args.action);
    if (source === "built-in") {
      console.log(`no override for ${args.action}`);
      return;
    }
    const proc = Bun.spawn(["diff", "-u", join(promptsDir, `${args.action}.md`), path], {
      stdout: "inherit",
      stderr: "inherit",
    });
    // diff exits 1 when the files differ; only 2+ is a failure
    if ((await proc.exited) > 1) throw new Error(`diff failed for ${args.action}`);
  }),
});

export default defineCommand({
  meta: { name: "prompt", description: "List, show, eject, and diff prompt templates" },
  subCommands: { list, show, eject, diff },
});
