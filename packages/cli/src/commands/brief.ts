import { next } from "@buildsmith/store";
import { defineCommand } from "citty";
import { renderBrief } from "../brief.ts";
import { act } from "../io.ts";

export default defineCommand({
  meta: { name: "brief", description: "Render the prompt for a task's next action" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    action: {
      type: "positional",
      description: "Action to brief (default: the task's next action)",
      required: false,
    },
    json: { type: "boolean", description: "Return { action, role, model, readonly, text }" },
  },
  run: act(async (store, args) => {
    const task = await store.tasks.get(args.id);
    const due = await next(store, task.id);
    const action = args.action ?? due.action;
    if (action === "none") {
      if (args.json) return { action };
      console.log("nothing to do");
      return;
    }
    const brief = await renderBrief(store, task, action, args.action ? "(requested)" : due.reason);
    if (args.json) return { action, ...brief };
    console.log(brief.text);
  }),
});
