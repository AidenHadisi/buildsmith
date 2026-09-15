import { findRoot, putAsset } from "../store/index.ts";
import { basename } from "node:path";
import { defineCommand } from "citty";

const put = defineCommand({
  meta: {
    name: "put",
    description: "Copy a file into a task's assets; prints the markdown image to embed it",
  },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    file: { type: "positional", description: "File to copy", required: true },
  },
  run: async ({ args }) => {
    const name = basename(args.file);
    const path = await putAsset(findRoot(), args.id, name, await Bun.file(args.file).bytes());
    return `![${name}](${path})`;
  },
});

export default defineCommand({
  meta: { name: "asset", description: "Copy files into a task's assets" },
  subCommands: { put },
});
