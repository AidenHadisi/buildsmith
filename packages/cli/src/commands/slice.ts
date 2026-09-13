import { sliceStatusSchema } from "@buildsmith/store";
import { defineCommand } from "citty";
import { act } from "../io.ts";

const add = defineCommand({
  meta: {
    name: "add",
    description: "Add a slice to a task; trailing arguments are acceptance criteria",
  },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    title: { type: "string", description: "Slice title", required: true },
    goal: { type: "string", description: "Slice goal", required: true },
  },
  // args._ holds the declared id first, then the criteria
  run: act((store, args) =>
    store.slices.add(args.id, {
      title: args.title,
      goal: args.goal,
      criteria: args._.slice(1),
    }),
  ),
});

const list = defineCommand({
  meta: { name: "list", description: "List a task's slices" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
  },
  run: act((store, args) => store.slices.list(args.id)),
});

const update = defineCommand({
  meta: { name: "update", description: "Update a slice's status or commit" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    n: { type: "positional", description: "Slice number", required: true },
    status: {
      type: "enum",
      description: "Slice status",
      options: sliceStatusSchema.options,
    },
    commit: { type: "string", description: "Commit hash" },
  },
  run: act((store, args) =>
    store.slices.update(args.id, Number(args.n), { status: args.status, commit: args.commit }),
  ),
});

export default defineCommand({
  meta: { name: "slice", description: "Add, list, and update task slices" },
  subCommands: { add, list, update },
});
