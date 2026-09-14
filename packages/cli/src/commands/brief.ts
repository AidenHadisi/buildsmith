import { next, type SliceRecord, type Store, type TaskRecord } from "@buildsmith/store";
import { join } from "node:path";
import { defineCommand } from "citty";
import { act } from "../io.ts";
import { load, render, repoPath, resolve } from "../prompts.ts";

const SLICE_PICK: Record<string, (slice: SliceRecord) => boolean> = {
  "work-slice": (s) => s.status !== "done",
  "review-slice": (s) => s.status === "review",
  "unblock-slice": (s) => s.status === "blocked",
};

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
    const { path } = await resolve(store.root, action);
    const { role, model, readonly, body } = await load(path);
    const reason = args.action ? "(requested)" : due.reason;
    const text = render(body, await vars(store, task, action, reason), path);
    if (args.json) return { action, role, model, readonly, text };
    console.log(text);
  }),
});

async function vars(store: Store, task: TaskRecord, action: string, reason: string) {
  const kind = action.endsWith("-spec") ? "spec" : "architecture";
  const doc = await store.docs.read(task.id, kind);
  const pick = SLICE_PICK[action];
  const matching = pick ? (await store.slices.list(task.id)).filter(pick) : [];
  const slices = action === "unblock-slice" ? matching : matching.slice(0, 1);
  const target = action.endsWith("-verification")
    ? "verification"
    : slices[0]
      ? `slice-${slices[0].n}`
      : kind;
  const verification = await store.docs.read(task.id, "verification");
  const notes = await store.notes.list(task.id, target);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    criteria: bullets(task.criteria),
    branch: task.branch ?? "(none)",
    project: (await optional(join(store.root, "project.md")))?.trimEnd() ?? "(none)",
    reason,
    revision: String(doc && "revision" in doc ? doc.revision : 0),
    doc: doc?.body.trimEnd() ?? "(none)",
    slice: slices.length > 0 ? slices.map(formatSlice).join("\n\n") : "(none)",
    verification: verification?.body.trimEnd() ?? "(none)",
    notes:
      notes.length > 0
        ? notes
            .map((n) => `- [${n.author}${n.verdict ? ` · ${n.verdict}` : ""}] ${n.body}`)
            .join("\n")
        : "(none)",
    cli: `bun ${Bun.main}`,
    extra: (await optional(repoPath(store.root, `${action}.extra`)))?.trimEnd() ?? "",
  };
}

function formatSlice(slice: SliceRecord): string {
  return [
    `#${slice.n} ${slice.title} — ${slice.goal}`,
    bullets(slice.criteria),
    `commit: ${slice.commit ?? "(none)"}`,
  ].join("\n");
}

function bullets(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "(none)";
}

async function optional(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : null;
}
