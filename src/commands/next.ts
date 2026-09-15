import { next } from "../pipeline.ts";
import { findRoot } from "../store/index.ts";
import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "next", description: "Show the next pipeline action for a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
  },
  run: ({ args }) => next(findRoot(), args.id),
});
