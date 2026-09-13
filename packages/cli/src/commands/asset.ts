import { basename } from "node:path";
import { defineCommand } from "citty";
import { act } from "../io.ts";

const put = defineCommand({
  meta: { name: "put", description: "Copy a file into a task's assets" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    file: { type: "positional", description: "File to copy", required: true },
  },
  run: act(async (store, args) =>
    store.assets.put(args.id, basename(args.file), await Bun.file(args.file).bytes()),
  ),
});

export default defineCommand({
  meta: { name: "asset", description: "Copy files into a task's assets" },
  subCommands: { put },
});
