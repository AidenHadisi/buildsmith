import { generateKeyBetween } from "fractional-indexing";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as z from "zod";
import { StoreError } from "./errors.ts";
import { listDir, record, slugify, withLock } from "./files.ts";
import { loadConfig } from "./repo.ts";

const taskSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  column: z.string(),
  order: z.string(),
  branch: z.string().optional(),
  pr: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
type TaskFrontmatter = z.infer<typeof taskSchema>;

export type TaskRecord = TaskFrontmatter & { description: string; dir: string };

const tasksDir = (root: string) => join(root, "tasks");
const taskFile = (dir: string) => record(join(dir, "task.md"), taskSchema);

const toTask = (dir: string, rec: { data: TaskFrontmatter; body: string }): TaskRecord => ({
  ...rec.data,
  description: rec.body.trim(),
  dir,
});

const readTask = async (dir: string) => toTask(dir, await taskFile(dir).require());

const listTaskNames = async (root: string) =>
  (await listDir(tasksDir(root))).filter((name) => !name.startsWith("."));

export async function taskDir(root: string, ref: string): Promise<string> {
  const tasks = tasksDir(root);
  const names = await listTaskNames(root);
  const exact = names.find((name) => name === ref);
  if (exact) return join(tasks, exact);
  const matches = names.filter((name) => name.startsWith(ref));
  const [match] = matches;
  if (!match) throw new StoreError("not_found", `task ${ref} not found`);
  if (matches.length > 1) throw new StoreError("ambiguous_id", `ambiguous task id ${ref}`);
  return join(tasks, match);
}

export async function createTask(
  root: string,
  input: { title: string; description: string; id?: string },
) {
  const { title, description } = input;
  const tasks = tasksDir(root);
  return withLock(tasks, async () => {
    const id = slugify(input.id ?? title);
    if ((await listDir(tasks)).includes(id)) {
      throw new StoreError("conflict", `task ${id} already exists`);
    }
    const column = loadConfig(root).columns[0]!;
    const last = (await listTasks(root)).findLast((t) => t.column === column);
    const now = new Date().toISOString();
    const data = {
      id,
      title,
      column,
      order: generateKeyBetween(last?.order ?? null, null),
      createdAt: now,
      updatedAt: now,
    };
    const dir = join(tasks, id);
    await mkdir(join(dir, "assets"), { recursive: true });
    await taskFile(dir).create(data, `${description.trim()}\n`);
    return { ...data, description: description.trim(), dir };
  });
}

export async function getTask(root: string, id: string) {
  return readTask(await taskDir(root, id));
}

export async function listTasks(root: string) {
  const names = await listTaskNames(root);
  const listed = await Promise.all(names.map((name) => readTask(join(tasksDir(root), name))));
  const { columns } = loadConfig(root);
  const rank = (column: string) => {
    const i = columns.indexOf(column);
    return i === -1 ? columns.length : i;
  };
  listed.sort(
    (a, b) =>
      rank(a.column) - rank(b.column) || a.order.localeCompare(b.order) || a.id.localeCompare(b.id),
  );
  return listed;
}

export async function moveTask(
  root: string,
  id: string,
  column: string,
  pos: { before?: string; after?: string } = {},
) {
  if (!loadConfig(root).columns.includes(column)) {
    throw new StoreError("invalid_input", `unknown column ${column}`);
  }
  const dir = await taskDir(root, id);
  const afterDir = pos.after ? await taskDir(root, pos.after) : undefined;
  const beforeDir = pos.before ? await taskDir(root, pos.before) : undefined;
  return withLock(tasksDir(root), async () => {
    const others = (await listTasks(root)).filter((t) => t.dir !== dir && t.column === column);
    const anchorDir = beforeDir ?? afterDir;
    const i = anchorDir ? others.findIndex((t) => t.dir === anchorDir) : others.length;
    if (anchorDir && i === -1) {
      throw new StoreError("not_found", `task ${pos.before ?? pos.after} not found in ${column}`);
    }
    const at = pos.before ? i : i + (pos.after ? 1 : 0);
    const order = generateKeyBetween(others[at - 1]?.order ?? null, others[at]?.order ?? null);
    const rec = await taskFile(dir).patch({
      column,
      order,
      updatedAt: new Date().toISOString(),
    });
    return toTask(dir, rec);
  });
}

export async function updateTask(
  root: string,
  id: string,
  patch: {
    title?: string;
    description?: string;
    branch?: string;
    pr?: string;
  },
) {
  const dir = await taskDir(root, id);
  const rec = await taskFile(dir).patch(
    {
      title: patch.title,
      branch: patch.branch,
      pr: patch.pr,
      updatedAt: new Date().toISOString(),
    },
    patch.description === undefined ? undefined : `${patch.description.trim()}\n`,
  );
  return toTask(dir, rec);
}

export async function putAsset(
  root: string,
  taskId: string,
  name: string,
  bytes: Uint8Array | string,
) {
  const dir = await taskDir(root, taskId);
  const safe = basename(name);
  if (!safe || safe === "." || safe === "..") {
    throw new StoreError("invalid_input", `invalid asset name ${name}`);
  }
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "assets", safe), bytes);
  return `assets/${safe}`;
}
