import { generateKeyBetween } from "fractional-indexing";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  createExclusive,
  findRoot,
  listDir,
  parseYaml,
  patchRecord,
  readOptional,
  readOptionalRecord,
  readRecord,
  splitSections,
  stringifyRecord,
  taskIdFromDir,
  withLock,
  writeAtomic,
} from "./files.ts";
import {
  DEFAULT_COLUMNS,
  configSchema,
  docSchema,
  docStatusSchema,
  noteEntrySchema,
  sliceSchema,
  taskSchema,
  type Config,
  type DocFrontmatter,
  type DocKind,
  type DocStatus,
  type NoteEntry,
  type SliceFrontmatter,
  type SliceStatus,
  type TaskFrontmatter,
  type VerificationResult,
} from "./schema.ts";

export type TaskRecord = TaskFrontmatter & { description: string; dir: string };
export type SliceRecord = SliceFrontmatter & { n: number; goal: string; file: string };
export type TaskDoc = DocFrontmatter & { kind: DocKind; body: string };

export type Store = Awaited<ReturnType<typeof openStore>>;

export async function openStore(cwd: string) {
  const root = await findRoot(cwd);
  if (root === null) {
    throw new Error(`no .buildsmith directory from ${cwd}`);
  }
  const config = await loadConfig(root);

  const taskDir = async (ref: string): Promise<string> => {
    const names = await listDir(join(root, "tasks"));
    const matches = names.filter((name) => {
      if (name.startsWith(".")) return false;
      const id = taskIdFromDir(name);
      return id === ref || id.startsWith(ref) || id.endsWith(ref);
    });
    const [match] = matches;
    if (!match) throw new Error(`task ${ref} not found`);
    if (matches.length > 1) throw new Error(`ambiguous task id ${ref}`);
    return join(root, "tasks", match);
  };

  const tasks = {
    async create(input: { title: string; description: string; criteria?: string[] }) {
      const { title, description, criteria = [] } = input;
      const tasksDir = join(root, "tasks");
      return withLock(tasksDir, async () => {
        const column = config.columns[0] ?? DEFAULT_COLUMNS[0];
        const existing = await tasks.list();
        const last = existing.findLast((t) => t.column === column);
        const now = new Date().toISOString();
        const data = {
          id: Bun.randomUUIDv7(),
          title,
          column,
          order: generateKeyBetween(last?.order ?? null, null),
          ...(criteria.length ? { criteria } : {}),
          createdAt: now,
          updatedAt: now,
        };
        const dir = join(tasksDir, `${data.id}-${slugify(title)}`);
        await mkdir(join(dir, "assets"), { recursive: true });
        await createExclusive(
          join(dir, "task.md"),
          stringifyRecord(data, `${description.trim()}\n`),
        );
        return { ...data, criteria, description: description.trim(), dir };
      });
    },

    async get(id: string) {
      const dir = await taskDir(id);
      const rec = await readRecord(join(dir, "task.md"), taskSchema);
      return { ...rec.data, description: rec.body.trim(), dir };
    },

    async list() {
      const tasksDir = join(root, "tasks");
      const listed: TaskRecord[] = [];
      for (const name of await listDir(tasksDir)) {
        if (name.startsWith(".")) continue;
        const dir = join(tasksDir, name);
        const rec = await readRecord(join(dir, "task.md"), taskSchema);
        listed.push({ ...rec.data, description: rec.body.trim(), dir });
      }
      const rank = (column: string) => {
        const i = config.columns.indexOf(column);
        return i === -1 ? config.columns.length : i;
      };
      listed.sort(
        (a, b) =>
          rank(a.column) - rank(b.column) ||
          a.order.localeCompare(b.order) ||
          a.id.localeCompare(b.id),
      );
      return listed;
    },

    async move(id: string, column: string, pos: { before?: string; after?: string } = {}) {
      if (!config.columns.includes(column)) {
        throw new Error(`unknown column ${column}`);
      }
      const dir = await taskDir(id);
      const afterDir = pos.after ? await taskDir(pos.after) : undefined;
      const beforeDir = pos.before ? await taskDir(pos.before) : undefined;
      return withLock(dir, async () => {
        const others = (await tasks.list())
          .filter((t) => t.dir !== dir && t.column === column)
          .sort((a, b) => a.order.localeCompare(b.order) || a.id.localeCompare(b.id));
        const anchorDir = beforeDir ?? afterDir;
        const i = anchorDir ? others.findIndex((t) => t.dir === anchorDir) : others.length;
        if (anchorDir && i === -1) {
          throw new Error(`task ${pos.before ?? pos.after} not found in ${column}`);
        }
        const at = pos.before ? i : i + (pos.after ? 1 : 0);
        const order = generateKeyBetween(others[at - 1]?.order ?? null, others[at]?.order ?? null);
        const rec = await patchRecord(join(dir, "task.md"), taskSchema, (doc) => {
          doc.set("column", column);
          doc.set("order", order);
          doc.set("updatedAt", new Date().toISOString());
        });
        return { ...rec.data, description: rec.body.trim(), dir };
      });
    },

    async update(
      id: string,
      patch: {
        title?: string;
        description?: string;
        criteria?: string[];
        branch?: string;
        pr?: string;
      },
    ) {
      const dir = await taskDir(id);
      return withLock(dir, async () => {
        const rec = await patchRecord(
          join(dir, "task.md"),
          taskSchema,
          (doc) => {
            if (patch.title !== undefined) doc.set("title", patch.title);
            if (patch.branch !== undefined) doc.set("branch", patch.branch);
            if (patch.pr !== undefined) doc.set("pr", patch.pr);
            if (patch.criteria !== undefined) doc.set("criteria", patch.criteria);
            doc.set("updatedAt", new Date().toISOString());
          },
          patch.description === undefined ? undefined : `${patch.description.trim()}\n`,
        );
        return { ...rec.data, description: rec.body.trim(), dir };
      });
    },
  };

  const docs = {
    async write(taskId: string, kind: DocKind, body: string) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const path = join(dir, `${kind}.md`);
        const prev = await readOptionalRecord(path, docSchema);
        const data =
          kind === "verification"
            ? { result: prev?.data.result }
            : {
                status: prev?.data.status === "approved" ? "draft" : (prev?.data.status ?? "draft"),
                revision:
                  prev?.data.status === "approved"
                    ? (prev.data.revision ?? 1) + 1
                    : (prev?.data.revision ?? 1),
              };
        await writeAtomic(path, stringifyRecord(data, body));
        return { kind, ...data, body };
      });
    },

    async read(taskId: string, kind: DocKind) {
      const rec = await readOptionalRecord(join(await taskDir(taskId), `${kind}.md`), docSchema);
      return rec && { kind, ...rec.data, body: rec.body.trimStart() };
    },

    async setStatus(taskId: string, kind: "spec" | "architecture", status: DocStatus) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const path = join(dir, `${kind}.md`);
        const rec = await readRecord(path, docSchema);
        const current = rec.data.status;
        if (
          current &&
          docStatusSchema.options.indexOf(status) <= docStatusSchema.options.indexOf(current)
        ) {
          throw new Error(`cannot move ${kind} status from ${current} to ${status}`);
        }
        const patched = await patchRecord(path, docSchema, (doc) => {
          doc.set("status", status);
        });
        return { kind, ...patched.data, body: patched.body.trimStart() };
      });
    },

    async setResult(taskId: string, kind: "verification", result: VerificationResult) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const patched = await patchRecord(join(dir, "verification.md"), docSchema, (doc) => {
          doc.set("result", result);
        });
        return { kind, ...patched.data, body: patched.body.trimStart() };
      });
    },
  };

  const slices = {
    async add(taskId: string, input: { title: string; goal: string; criteria: string[] }) {
      const { title, goal, criteria } = input;
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const slicesDir = join(dir, "slices");
        await mkdir(slicesDir, { recursive: true });
        const existing = await listSlices(dir);
        const n = (existing.at(-1)?.n ?? 0) + 1;
        const file = join(slicesDir, `${String(n).padStart(2, "0")}-${slugify(title)}.md`);
        const data = {
          title,
          status: "todo" as const,
          ...(criteria.length ? { criteria } : {}),
        };
        await createExclusive(file, stringifyRecord(data, `${goal.trim()}\n`));
        return { ...data, criteria, n, goal: goal.trim(), file };
      });
    },

    async list(taskId: string) {
      return listSlices(await taskDir(taskId));
    },

    async update(taskId: string, n: number, patch: { status?: SliceStatus; commit?: string }) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const slice = (await listSlices(dir)).find((s) => s.n === n);
        if (!slice) throw new Error(`slice ${n} not found on task ${taskId}`);
        const rec = await patchRecord(slice.file, sliceSchema, (doc) => {
          if (patch.status !== undefined) doc.set("status", patch.status);
          if (patch.commit !== undefined) doc.set("commit", patch.commit);
        });
        return { ...rec.data, n, goal: rec.body.trim(), file: slice.file };
      });
    },
  };

  const notes = {
    async add(
      taskId: string,
      input: { author: string; target: string; verdict?: string; body: string },
    ) {
      const { author, target, verdict, body } = input;
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const path = join(dir, "notes.md");
        const entry = noteEntrySchema.parse({
          at: new Date().toISOString(),
          author,
          target,
          verdict,
          body: body.trim(),
        });
        const heading = [entry.at, entry.author, entry.target, entry.verdict]
          .filter(Boolean)
          .join(" · ");
        const section = `## ${heading}\n\n${entry.body}\n`;
        const existing = (await readOptional(path)) ?? "";
        const next = existing.trim() ? `${existing.replace(/\s*$/, "")}\n\n${section}` : section;
        await writeAtomic(path, next);
        return entry;
      });
    },

    async list(taskId: string, target?: string) {
      const raw = await readOptional(join(await taskDir(taskId), "notes.md"));
      if (raw === null) return [];
      const entries: NoteEntry[] = [];
      for (const section of splitSections(raw).sections) {
        const [at, author, targetName, ...rest] = section.heading.split(" · ").map((p) => p.trim());
        const parsed = noteEntrySchema.safeParse({
          at,
          author,
          target: targetName,
          verdict: rest.length > 0 ? rest.join(" · ") : undefined,
          body: section.body,
        });
        if (parsed.success) entries.push(parsed.data);
      }
      return target ? entries.filter((e) => e.target === target) : entries;
    },
  };

  const projectPath = join(root, "project.md");
  const project = {
    async read() {
      const raw = await readOptional(projectPath);
      if (raw === null) throw new Error(`missing ${projectPath}`);
      return raw;
    },
    async write(body: string) {
      await writeAtomic(projectPath, body.endsWith("\n") ? body : `${body}\n`);
    },
    async addLesson(text: string) {
      const raw = await project.read();
      const lesson = `- ${text.trim()}`;
      const { preamble, sections } = splitSections(raw);
      const lessons = sections.find((s) => s.heading === "Lessons");
      if (!lessons) {
        await writeAtomic(projectPath, `${raw.replace(/\s*$/, "")}\n\n## Lessons\n\n${lesson}\n`);
        return;
      }
      lessons.body = lessons.body ? `${lessons.body}\n${lesson}` : lesson;
      const chunks = [
        ...(preamble.trim() ? [preamble.trimEnd()] : []),
        ...sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}\n`),
      ];
      await writeAtomic(projectPath, chunks.join("\n").replace(/\n*$/, "\n"));
    },
  };

  const assets = {
    async put(taskId: string, name: string, bytes: Uint8Array | string) {
      const dir = await taskDir(taskId);
      const safe = basename(name);
      if (!safe || safe === "." || safe === "..") {
        throw new Error(`invalid asset name ${name}`);
      }
      const rel = join("assets", safe);
      await mkdir(join(dir, "assets"), { recursive: true });
      await writeFile(join(dir, rel), bytes);
      return rel.replaceAll("\\", "/");
    },
  };

  return { root, config, tasks, docs, slices, notes, project, assets };
}

async function loadConfig(root: string): Promise<Config> {
  const raw = await readOptional(join(root, "config.yml"));
  if (raw === null) return configSchema.parse({});
  try {
    return configSchema.parse(parseYaml(raw) ?? {});
  } catch (err) {
    throw new Error(`invalid config.yml`, { cause: err });
  }
}

async function listSlices(taskDirPath: string): Promise<SliceRecord[]> {
  const slicesDir = join(taskDirPath, "slices");
  const slices: SliceRecord[] = [];
  for (const name of await listDir(slicesDir)) {
    const n = Number(name.match(/^(\d+)-.+\.md$/)?.[1]);
    if (!n) continue;
    const file = join(slicesDir, name);
    const rec = await readRecord(file, sliceSchema);
    slices.push({ ...rec.data, n, goal: rec.body.trim(), file });
  }
  return slices.sort((a, b) => a.n - b.n);
}

function slugify(title: string, max = 48): string {
  const s = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
    .replace(/-$/, "");
  return s || "task";
}
