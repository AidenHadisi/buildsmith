import { next, type Store, type TaskRecord } from "@buildsmith/store";
import { join } from "node:path";
import { defineCommand } from "citty";
import { cli, renderBrief, SLICE_PICK } from "../brief.ts";
import { act, json } from "../io.ts";

type Step =
  | { do: "done"; action: "none" }
  | { do: "ask"; action: string; text: string }
  | { do: "self"; action: string; text: string }
  | { do: "dispatch"; action: string; agent: string; model: string; prompt: string };

type Marker = { action: string; fingerprint: string; repeats: number };

export default defineCommand({
  meta: {
    name: "step",
    description: "Decide the next step for a task: done, ask, self, or dispatch",
  },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    json: { type: "boolean", description: "Return { do, action, ... } (default when not a TTY)" },
  },
  run: act(async (store, args) => {
    const task = await store.tasks.get(args.id);
    const step = await decide(store, task);
    if (step.do === "self" && !json) {
      console.log(step.text);
      return;
    }
    return step;
  }),
});

async function decide(store: Store, task: TaskRecord): Promise<Step> {
  const due = await next(store, task.id);
  const { action } = due;
  if (action === "none") return { do: "done", action };
  const cap = await capHit(store, task.id, action);
  if (cap) return { do: "ask", action, text: cap };
  const brief = await renderBrief(store, task, action, due.reason);
  if (brief.role === "planner" || brief.role === "user") {
    return { do: "self", action, text: brief.text };
  }
  const repeats = await trackStall(task, action, await fingerprint(store, task));
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
    agent: brief.readonly ? "buildsmith-reader" : "buildsmith-worker",
    model: brief.model,
    prompt: `${nudge}Run \`${cli} brief ${task.id}\` and follow it exactly, including its Record section. Return one line.`,
  };
}

async function capHit(store: Store, taskId: string, action: string): Promise<string | undefined> {
  if (action.endsWith("-spec") || action.endsWith("-architecture")) {
    const kind = action.endsWith("-spec") ? "spec" : "architecture";
    const doc = await store.docs.read(taskId, kind);
    if (doc && "revision" in doc && doc.revision >= 5) {
      return `${kind} has reached revision ${doc.revision}; discuss with the user whether to approve it as-is or narrow the task.`;
    }
  }
  if (action === "work-slice" || action === "review-slice") {
    const pick = SLICE_PICK[action];
    const slice = pick && (await store.slices.list(taskId)).find(pick);
    const revises = slice ? await verdicts(store, taskId, `slice-${slice.n}`, "revise") : 0;
    if (slice && revises >= 3) {
      return `slice ${slice.n} has been sent back ${revises} times; discuss with the user whether to split it or change its approach.`;
    }
  }
  if (action === "run-verification") {
    const fails = await verdicts(store, taskId, "verification", "fail");
    if (fails >= 2) {
      return `verification has failed ${fails} times; discuss with the user what is broken before running it again.`;
    }
  }
  return undefined;
}

async function verdicts(store: Store, taskId: string, target: string, verdict: string) {
  return (await store.notes.list(taskId, target)).filter((n) => n.verdict === verdict).length;
}

async function fingerprint(store: Store, task: TaskRecord): Promise<string> {
  const docs = await Promise.all(
    (["spec", "architecture", "verification"] as const).map((kind) =>
      store.docs.read(task.id, kind),
    ),
  );
  const board = {
    task,
    slices: await store.slices.list(task.id),
    notes: await store.notes.list(task.id),
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
