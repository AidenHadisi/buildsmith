import { Store } from "@buildsmith/store";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { print } from "../io.ts";

export default defineCommand({
  meta: { name: "init", description: "Create a .buildsmith directory" },
  args: {
    dir: { type: "positional", description: "Directory to initialize", required: false },
  },
  run: async ({ args }) => print(await Store.init(resolve(args.dir ?? "."))),
});
