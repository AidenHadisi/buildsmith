import type { SliceRecord, Store, TaskRecord } from "@buildsmith/store";
import { join } from "node:path";
import { load, render, repoPath, resolve, type Prompt } from "./prompts.ts";

export type Brief = Omit<Prompt, "body"> & { text: string };

export const SLICE_PICK: Record<string, (slice: SliceRecord) => boolean> = {
  "work-slice": (s) => s.status !== "done",
  "review-slice": (s) => s.status === "review",
  "unblock-slice": (s) => s.status === "blocked",
};

export const cli = Bun.isStandaloneExecutable ? process.execPath : `bun ${Bun.main}`;

export async function renderBrief(
  store: Store,
  task: TaskRecord,
  action: string,
  reason: string,
): Promise<Brief> {
  const { path } = await resolve(store.root, action);
  const { role, model, readonly, body } = await load(path);
  const text = render(body, await vars(store, task, action, reason), path);
  return { role, model: resolveModel(store, model), readonly, text };
}

function resolveModel(store: Store, model: string): string {
  if (model === "strong" || model === "fast") return store.config.models[model] ?? model;
  return model;
}

async function vars(store: Store, task: TaskRecord, action: string, reason: string) {
  const kind = action.endsWith("-spec") ? "spec" : "architecture";
  const doc = await store.docs.read(task.id, kind);
  const pick = SLICE_PICK[action];
  const slice = pick ? (await store.slices.list(task.id)).find(pick) : undefined;
  const target = action.endsWith("-verification")
    ? "verification"
    : slice
      ? `slice-${slice.n}`
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
    slice: slice ? formatSlice(slice) : "(none)",
    verification: verification?.body.trimEnd() ?? "(none)",
    notes:
      notes.length > 0
        ? notes
            .map((n) => `### ${n.author}${n.verdict ? ` · ${n.verdict}` : ""}\n\n${n.body}`)
            .join("\n\n")
        : "(none)",
    cli,
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
