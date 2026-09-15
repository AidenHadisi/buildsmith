import { init } from "../store/index.ts";
import { resolve } from "node:path";
import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "init", description: "Create a .buildsmith directory" },
  args: {
    dir: { type: "positional", description: "Directory to initialize", required: false },
  },
  run: ({ args }) => init(resolve(args.dir ?? ".")),
});
