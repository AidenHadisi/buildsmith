import { findRoot, getTask } from "../store/index.ts";
import { defineCommand } from "citty";
import { next } from "../pipeline.ts";
import { renderBrief } from "../brief.ts";

export default defineCommand({
  meta: { name: "brief", description: "Render the prompt for a task's next action" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    action: {
      type: "positional",
      description: "Action to brief (default: the task's next action)",
      required: false,
    },
  },
  run: async ({ args }) => {
    const root = findRoot();
    const task = await getTask(root, args.id);
    const due = await next(root, task.id);
    const action = args.action ?? due.action;
    if (action === "none") return { action };
    const brief = await renderBrief(root, task, action, args.action ? "(requested)" : due.reason);
    return { action, ...brief };
  },
});
