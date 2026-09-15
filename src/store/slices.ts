import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import { StoreError } from "./errors.ts";
import { listDir, record, slugify, splitSections, withLock } from "./files.ts";
import { taskDir } from "./tasks.ts";

export const sliceStatusSchema = z.enum(["todo", "doing", "review", "done", "blocked"]);
export type SliceStatus = z.infer<typeof sliceStatusSchema>;

const sliceSchema = z.looseObject({
  title: z.string(),
  status: sliceStatusSchema,
  commit: z.string().optional(),
  criteria: z.array(z.string()).default([]),
});
type SliceFrontmatter = z.infer<typeof sliceSchema>;

export type SliceRecord = SliceFrontmatter & { n: number; goal: string; file: string };

const sliceFile = (file: string) => record(file, sliceSchema);

const toSlice = (
  n: number,
  file: string,
  rec: { data: SliceFrontmatter; body: string },
): SliceRecord => ({ ...rec.data, n, goal: rec.body.trim(), file });

export async function listSlices(root: string, taskId: string): Promise<SliceRecord[]> {
  const slicesDir = join(await taskDir(root, taskId), "slices");
  const slices = (
    await Promise.all(
      (await listDir(slicesDir)).map(async (name) => {
        const n = Number(name.match(/^(\d+)-.+\.md$/)?.[1]);
        if (!n) return;
        const file = join(slicesDir, name);
        return toSlice(n, file, await sliceFile(file).require());
      }),
    )
  ).filter((s) => s !== undefined);
  return slices.sort((a, b) => a.n - b.n);
}

export type SliceInput = { title: string; goal: string; criteria: string[] };

export function parseSlices(architectureBody: string): SliceInput[] {
  const section = splitSections(architectureBody).sections.find(
    (s) => s.heading.toLowerCase() === "slices",
  );
  const slices: SliceInput[] = [];
  let current: SliceInput | null = null;
  let goalSeen = false;
  let inCriteria = false;
  let fence: string | null = null;

  const finish = (slice: SliceInput | null) => {
    if (!slice) return;
    if (!slice.goal) throw new StoreError("invalid_input", `slice "${slice.title}" has no goal`);
    if (slice.criteria.length === 0) {
      throw new StoreError("invalid_input", `slice "${slice.title}" has no criteria`);
    }
    slices.push(slice);
  };

  for (const line of section?.body.split("\n") ?? []) {
    const run = line.match(/^ {0,3}([`~]{3,})/)?.[1];
    if (fence) {
      if (run && run[0] === fence[0] && run.length >= fence.length) fence = null;
      continue;
    }
    if (run) {
      fence = run;
      continue;
    }
    const heading = line.match(/^###\s+(.+?)\s*$/)?.[1];
    if (heading) {
      finish(current);
      current = { title: heading.replace(/^\d+[.)]\s*/, ""), goal: "", criteria: [] };
      goalSeen = false;
      inCriteria = false;
      continue;
    }
    if (!current) continue;
    const text = line.trim();
    if (!goalSeen && text !== "") {
      goalSeen = true;
      if (!/^(\*\*|-\s|\d+\.\d+)/.test(text)) current.goal = text;
    }
    if (/^(?:\*\*)?Criteria:(?:\*\*)?\s*$/.test(text)) {
      inCriteria = true;
      continue;
    }
    if (inCriteria) {
      if (/^(?:\*\*)?[A-Z][a-z]+:/.test(text)) {
        inCriteria = false;
        continue;
      }
      const bullet = text.match(/^-\s+(.+?)\s*$/)?.[1];
      if (bullet) current.criteria.push(bullet);
    }
  }
  finish(current);
  if (slices.length === 0) {
    throw new StoreError(
      "invalid_input",
      "architecture has no ## Slices section with at least one slice",
    );
  }
  return slices;
}

async function createSlice(dir: string, n: number, input: SliceInput): Promise<SliceRecord> {
  const slicesDir = join(dir, "slices");
  await mkdir(slicesDir, { recursive: true });
  const file = join(slicesDir, `${String(n).padStart(2, "0")}-${slugify(input.title)}.md`);
  const data = {
    title: input.title,
    status: "todo" as const,
    criteria: input.criteria.length ? input.criteria : undefined,
  };
  await sliceFile(file).create(data, `${input.goal.trim()}\n`);
  return { ...data, criteria: input.criteria, n, goal: input.goal.trim(), file };
}

export async function addSlice(root: string, taskId: string, input: SliceInput) {
  const dir = await taskDir(root, taskId);
  return withLock(dir, async () => {
    const existing = await listSlices(root, taskId);
    return createSlice(dir, (existing.at(-1)?.n ?? 0) + 1, input);
  });
}

export async function seedSlices(
  root: string,
  taskId: string,
  architectureBody: string,
): Promise<SliceRecord[]> {
  const parsed = parseSlices(architectureBody);
  const dir = await taskDir(root, taskId);
  return withLock(dir, async () => {
    const existing = await listSlices(root, taskId);
    if (existing.length > 0) return existing;
    const created: SliceRecord[] = [];
    for (const input of parsed) created.push(await createSlice(dir, created.length + 1, input));
    return created;
  });
}

export async function updateSlice(
  root: string,
  taskId: string,
  n: number,
  patch: { status?: SliceStatus; commit?: string },
) {
  const slice = (await listSlices(root, taskId)).find((s) => s.n === n);
  if (!slice) throw new StoreError("not_found", `slice ${n} not found on task ${taskId}`);
  return toSlice(n, slice.file, await sliceFile(slice.file).patch(patch));
}
