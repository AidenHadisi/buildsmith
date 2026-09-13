import { next } from "@buildsmith/store";
import { defineCommand } from "citty";
import { act } from "../io.ts";

const create = defineCommand({
  meta: { name: "create", description: "Create a task" },
  args: {
    title: { type: "string", description: "Task title", required: true },
    description: { type: "string", description: "Task description" },
  },
  // criteria are rest positionals (0 declared): args._.slice(0)
  run: act((store, args) =>
    store.tasks.create({
      title: args.title,
      description: args.description ?? "",
      criteria: args._.slice(0),
    }),
  ),
});

const list = defineCommand({
  meta: { name: "list", description: "List tasks with their next action" },
  run: act(async (store) => {
    const tasks = await store.tasks.list();
    return Promise.all(tasks.map(async (task) => ({ ...task, next: await next(store, task.id) })));
  }),
});

const get = defineCommand({
  meta: { name: "get", description: "Show a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
  },
  run: act((store, args) => store.tasks.get(args.id)),
});

const move = defineCommand({
  meta: { name: "move", description: "Move a task to a column" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    column: { type: "positional", description: "Target column", required: true },
    before: { type: "string", description: "Place before this task" },
    after: { type: "string", description: "Place after this task" },
  },
  run: act((store, args) =>
    store.tasks.move(args.id, args.column, { before: args.before, after: args.after }),
  ),
});

const update = defineCommand({
  meta: { name: "update", description: "Update a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    title: { type: "string", description: "Task title" },
    description: { type: "string", description: "Task description" },
    branch: { type: "string", description: "Branch name" },
    pr: { type: "string", description: "Pull request URL" },
  },
  // criteria are rest positionals after 1 declared (id): args._.slice(1); undefined fields are no-ops in the store
  run: act((store, args) =>
    store.tasks.update(args.id, {
      title: args.title,
      description: args.description,
      branch: args.branch,
      pr: args.pr,
      criteria: args._.length > 1 ? args._.slice(1) : undefined,
    }),
  ),
});

export default defineCommand({
  meta: { name: "task", description: "Create, read, and move tasks" },
  subCommands: { create, list, get, move, update },
});
