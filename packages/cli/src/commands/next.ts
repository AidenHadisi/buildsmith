import { next } from "@buildsmith/store";
import { defineCommand } from "citty";
import { act } from "../io.ts";

export default defineCommand({
  meta: { name: "next", description: "Show the next pipeline action for a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
  },
  run: act((store, args) => next(store, args.id)),
});
