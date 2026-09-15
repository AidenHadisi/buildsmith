import {
  listNotes,
  listSlices,
  loadConfig,
  readDoc,
  type SliceRecord,
  type TaskRecord,
} from "./store/index.ts";
import { join } from "node:path";
import {
  actions,
  load,
  render,
  repoPath,
  resolve,
  snippet,
  standard,
  type Prompt,
} from "./prompts.ts";

export type Brief =
  | { run: "self"; text: string }
  | { run: "dispatch"; model: string; readonly: boolean; text: string };

const SLICE_PICK: Record<string, (slice: SliceRecord) => boolean> = {
  "work-slice": (s) => s.status !== "done",
  "unblock-slice": (s) => s.status === "blocked",
};

export const cli = Bun.isStandaloneExecutable ? process.execPath : `bun ${Bun.main}`;

export async function renderBrief(
  root: string,
  task: TaskRecord,
  action: string,
  reason: string,
): Promise<Brief> {
  if (!(await actions()).includes(action)) throw new Error(`unknown action ${action}`);
  const { path } = await resolve(root, action);
  const { body, ...prompt } = await load(path);
  const text = render(body, await vars(root, task, action, reason), path);
  if (prompt.run === "self") return { ...prompt, text };
  return { ...prompt, model: resolveModel(root, prompt.model), text };
}

function resolveModel(root: string, model: string): string {
  if (model === "strong" || model === "fast") return loadConfig(root).models[model];
  return model;
}

async function vars(root: string, task: TaskRecord, action: string, reason: string) {
  const kind = action.endsWith("-spec") ? "spec" : "architecture";
  const doc = await readDoc(root, task.id, kind);
  const pick = SLICE_PICK[action];
  const slice = pick ? (await listSlices(root, task.id)).find(pick) : undefined;
  const spec = kind === "spec" ? doc : await readDoc(root, task.id, "spec");
  const verification = await readDoc(root, task.id, "verification");
  const notes = await listNotes(root, task.id, noteTarget(action, kind, slice));
  const [designStandards, specStandards, taskCard, delegate] = await Promise.all([
    standard(root, "design"),
    standard(root, "spec"),
    snippet(root, "include/task"),
    snippet(root, "include/delegate"),
  ]);
  const slots: Record<string, string> = {
    id: task.id,
    title: task.title,
    description: task.description,
    branch: task.branch ?? "(none)",
    project: (await optional(join(root, "project.md")))?.trimEnd() ?? "(none)",
    reason,
    revision: String(doc?.revision ?? 0),
    doc: doc?.body.trimEnd() ?? "(none)",
    spec: spec?.body.trimEnd() ?? "(none)",
    slice: slice ? formatSlice(slice) : "(none)",
    verification: verification?.body.trimEnd() ?? "(none)",
    design_standards: designStandards,
    spec_standards: specStandards,
    delegate: delegate.text,
    notes:
      notes
        .map((n) => `### ${n.author}${n.verdict ? ` · ${n.verdict}` : ""}\n\n${n.body}`)
        .join("\n\n") || "(none)",
    cli,
    extra: (await optional(repoPath(root, `${action}.extra`)))?.trimEnd() ?? "",
  };
  return { ...slots, task: render(taskCard.text, slots, taskCard.path) };
}

function noteTarget(action: string, kind: string, slice?: SliceRecord): string {
  if (action === "polish") return "polish";
  if (action === "review-branch" || action === "work-branch") return "branch";
  if (action.endsWith("-verification")) return "verification";
  return slice ? `slice-${slice.n}` : kind;
}

function formatSlice(slice: SliceRecord): string {
  return [
    `#${slice.n} ${slice.title} — ${slice.goal}`,
    slice.criteria.map((c) => `- ${c}`).join("\n") || "(none)",
    `commit: ${slice.commit ?? "(none)"}`,
  ].join("\n");
}

async function optional(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : null;
}
