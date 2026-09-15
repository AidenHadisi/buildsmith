import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import { listDir, record, slugify } from "./files.ts";
import { taskDir } from "./tasks.ts";

const noteSchema = z.looseObject({
  at: z.iso.datetime(),
  author: z.string().min(1),
  target: z.string().min(1),
  verdict: z.string().min(1).optional(),
});
export type NoteEntry = z.infer<typeof noteSchema> & { body: string };

export async function addNote(
  root: string,
  taskId: string,
  input: { author: string; target: string; verdict?: string; body: string },
) {
  const { author, target, verdict, body } = input;
  const notesDir = join(await taskDir(root, taskId), "notes");
  await mkdir(notesDir, { recursive: true });
  const at = new Date().toISOString();
  const data = noteSchema.parse({ at, author, target, verdict });
  const file = join(notesDir, `${Bun.randomUUIDv7()}-${slugify(target)}.md`);
  await record(file, noteSchema).create(data, `${body.trim()}\n`);
  return { ...data, body: body.trim() };
}

export async function listNotes(root: string, taskId: string, target?: string) {
  const notesDir = join(await taskDir(root, taskId), "notes");
  const names = (await listDir(notesDir)).filter((name) => name.endsWith(".md")).sort();
  const entries = (
    await Promise.all(
      names.map(async (name) => {
        const rec = await record(join(notesDir, name), noteSchema).read();
        return rec ? { ...rec.data, body: rec.body.trim() } : undefined;
      }),
    )
  ).filter((e) => e !== undefined);
  return target ? entries.filter((e) => e.target === target) : entries;
}
