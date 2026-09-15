import { createTask, findRoot, getTask, listTasks, moveTask, updateTask } from "../store/index.ts";
import { defineCommand } from "citty";
import { next } from "../pipeline.ts";
import { piped } from "./stdin.ts";

const create = defineCommand({
  meta: {
    name: "create",
    description: "Create a task; the description is read from stdin unless given",
  },
  args: {
    id: { type: "string", description: "Task id (slug); default: from the title" },
    title: { type: "string", description: "Task title", required: true },
    description: { type: "string", description: "Task description (short form)" },
  },
  run: async ({ args }) =>
    createTask(findRoot(), {
      id: args.id,
      title: args.title,
      description: args.description ?? (await piped()),
    }),
});

const list = defineCommand({
  meta: { name: "list", description: "List tasks with their next action" },
  run: async () => {
    const root = findRoot();
    const tasks = await listTasks(root);
    return Promise.all(tasks.map(async (task) => ({ ...task, next: await next(root, task.id) })));
  },
});

const get = defineCommand({
  meta: { name: "get", description: "Show a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
  },
  run: ({ args }) => getTask(findRoot(), args.id),
});

const move = defineCommand({
  meta: { name: "move", description: "Move a task to a column" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    column: { type: "positional", description: "Target column", required: true },
    before: { type: "string", description: "Place before this task" },
    after: { type: "string", description: "Place after this task" },
  },
  run: ({ args }) =>
    moveTask(findRoot(), args.id, args.column, { before: args.before, after: args.after }),
});

const update = defineCommand({
  meta: { name: "update", description: "Update a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    title: { type: "string", description: "Task title" },
    description: { type: "string", description: "Task description" },
    branch: { type: "string", description: "Branch name" },
    pr: { type: "string", description: "Pull request URL" },
  },
  run: ({ args }) =>
    updateTask(findRoot(), args.id, {
      title: args.title,
      description: args.description,
      branch: args.branch,
      pr: args.pr,
    }),
});

export default defineCommand({
  meta: { name: "task", description: "Create, list, move, and update tasks" },
  subCommands: { create, list, get, move, update },
});
