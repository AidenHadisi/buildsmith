import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as z from "zod";
import { StoreError } from "./errors.ts";
import { listDir, record, slugify, withLock } from "./files.ts";

const taskSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
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
    const now = new Date().toISOString();
    const data = { id, title, createdAt: now, updatedAt: now };
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
  listed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return listed;
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
