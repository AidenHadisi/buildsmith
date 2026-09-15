import {
  findRoot,
  getTask,
  listNotes,
  listSlices,
  readDoc,
  type TaskRecord,
} from "../store/index.ts";
import { join } from "node:path";
import { defineCommand } from "citty";
import { next } from "../pipeline.ts";
import { cli, renderBrief } from "../brief.ts";

type Step =
  | { do: "done"; action: "none" }
  | { do: "ask"; action: string; text: string }
  | { do: "self"; action: string; text: string }
  | { do: "dispatch"; action: string; readonly: boolean; model: string; prompt: string };

type Marker = { action: string; fingerprint: string; repeats: number };

export default defineCommand({
  meta: {
    name: "step",
    description: "Decide the next step for a task: done, ask, self, or dispatch",
  },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
  },
  run: async ({ args }) => {
    const root = findRoot();
    const task = await getTask(root, args.id);
    return decide(root, task);
  },
});

async function decide(root: string, task: TaskRecord): Promise<Step> {
  const due = await next(root, task.id);
  const { action } = due;
  if (action === "none") return { do: "done", action };
  if (due.ask) return { do: "ask", action, text: due.ask };
  const brief = await renderBrief(root, task, action, due.reason);
  if (brief.role === "planner" || brief.role === "user") {
    return { do: "self", action, text: brief.text };
  }
  const repeats = await trackStall(task, action, await fingerprint(root, task));
  if (repeats >= 2) {
    return {
      do: "ask",
      action,
      text: `the board has not changed after two dispatches of ${action}; discuss with the user whether the agent is failing to record its work or the step needs a hand.`,
    };
  }
  const nudge =
    repeats === 1 ? "The board did not change after the last run; run the Record commands. " : "";
  return {
    do: "dispatch",
    action,
    readonly: brief.readonly,
    model: brief.model,
    prompt: `${nudge}Run \`${cli} brief ${task.id}\` and follow it exactly, including its Record section. Return one line.`,
  };
}

async function fingerprint(root: string, task: TaskRecord): Promise<string> {
  const docs = await Promise.all(
    (["spec", "architecture", "verification"] as const).map((kind) => readDoc(root, task.id, kind)),
  );
  const board = {
    task,
    slices: await listSlices(root, task.id),
    notes: await listNotes(root, task.id),
    docs: docs.map((doc) =>
      doc?.kind === "verification" ? doc.result : doc && [doc.status, doc.revision],
    ),
  };
  return Bun.hash(JSON.stringify(board)).toString(36);
}

async function trackStall(task: TaskRecord, action: string, fingerprint: string) {
  const file = Bun.file(join(task.dir, ".step.json"));
  const prev: Marker | null = (await file.exists()) ? await file.json() : null;
  const repeats =
    prev?.action === action && prev.fingerprint === fingerprint ? prev.repeats + 1 : 0;
  await Bun.write(file, JSON.stringify({ action, fingerprint, repeats }));
  return repeats;
}
