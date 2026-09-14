import { generateKeyBetween } from "fractional-indexing";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { z } from "zod";
import {
  createExclusive,
  findRoot,
  joinFrontmatter,
  parseYaml,
  patchRecord,
  readOptional,
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
  noteEntrySchema,
  pipelineDocSchema,
  sliceSchema,
  taskSchema,
  verificationSchema,
  type Config,
  type DocKind,
  type DocStatus,
  type NoteEntry,
  type PipelineDocFrontmatter,
  type SliceFrontmatter,
  type SliceStatus,
  type TaskFrontmatter,
  type VerificationFrontmatter,
  type VerificationResult,
} from "./schema.ts";

const DOC_STATUS_RANK: Record<DocStatus, number> = {
  draft: 0,
  critiqued: 1,
  reviewed: 2,
  approved: 3,
};

export type TaskRecord = TaskFrontmatter & {
  description: string;
  criteria: string[];
  dir: string;
};

export type SliceRecord = SliceFrontmatter & {
  n: number;
  goal: string;
  criteria: string[];
  file: string;
};

export type PipelineDoc = PipelineDocFrontmatter & {
  kind: "spec" | "architecture";
  body: string;
};

export type VerificationDoc = VerificationFrontmatter & {
  kind: "verification";
  body: string;
};

export type TaskDoc = PipelineDoc | VerificationDoc;

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
        const existing = await listTasks(root, config);
        const last = existing.findLast((t) => t.column === column);
        const now = new Date().toISOString();
        const data: TaskFrontmatter = {
          id: Bun.randomUUIDv7(),
          title,
          column,
          order: generateKeyBetween(last?.order ?? null, null),
          createdAt: now,
          updatedAt: now,
        };
        const dir = join(tasksDir, `${data.id}-${slugify(title)}`);
        const body = bodyWithSection(description, "Acceptance criteria", criteria);
        await mkdir(join(dir, "assets"), { recursive: true });
        await createExclusive(join(dir, "task.md"), stringifyRecord(data, body));
        return toTask(dir, data, body);
      });
    },

    async get(id: string) {
      const dir = await taskDir(id);
      const rec = await readRecord(join(dir, "task.md"), taskSchema);
      return toTask(dir, rec.data, rec.body);
    },

    async list() {
      return listTasks(root, config);
    },

    async move(id: string, column: string, pos: { before?: string; after?: string } = {}) {
      if (!config.columns.includes(column)) {
        throw new Error(`unknown column ${column}`);
      }
      const dir = await taskDir(id);
      const afterDir = pos.after ? await taskDir(pos.after) : undefined;
      const beforeDir = pos.before ? await taskDir(pos.before) : undefined;
      return withLock(dir, async () => {
        const all = await listTasks(root, config);
        const others = all
          .filter((t) => t.dir !== dir && t.column === column)
          .sort((a, b) => a.order.localeCompare(b.order) || a.id.localeCompare(b.id));
        const after = others.find((t) => t.dir === afterDir);
        const before = others.find((t) => t.dir === beforeDir);
        if (afterDir && !after) {
          throw new Error(`task ${pos.after} not found in ${column}`);
        }
        if (beforeDir && !before) {
          throw new Error(`task ${pos.before} not found in ${column}`);
        }
        const indexOf = (task: TaskRecord) => others.findIndex((t) => t.dir === task.dir);
        const lo = after ?? (before ? others[indexOf(before) - 1] : others.at(-1));
        const hi = before ?? (after ? others[indexOf(after) + 1] : undefined);
        const order = generateKeyBetween(lo?.order ?? null, hi?.order ?? null);
        const rec = await patchRecord(join(dir, "task.md"), taskSchema, (doc) => {
          doc.set("column", column);
          doc.set("order", order);
          doc.set("updatedAt", new Date().toISOString());
        });
        return toTask(dir, rec.data, rec.body);
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
      const path = join(dir, "task.md");
      return withLock(dir, async () => {
        const rec = await readRecord(path, taskSchema);
        if (patch.title !== undefined) rec.doc.set("title", patch.title);
        if (patch.branch !== undefined) rec.doc.set("branch", patch.branch);
        if (patch.pr !== undefined) rec.doc.set("pr", patch.pr);
        rec.doc.set("updatedAt", new Date().toISOString());
        const data = taskSchema.parse(rec.doc.toJS() ?? {});
        const { preamble, bullets } = parseBody(rec.body, "Acceptance criteria");
        const body = bodyWithSection(
          patch.description ?? preamble,
          "Acceptance criteria",
          patch.criteria ?? bullets,
        );
        await writeAtomic(
          path,
          joinFrontmatter(rec.doc.toString({ lineWidth: 0 }), body, rec.eol, rec.bom),
        );
        return toTask(dir, data, body);
      });
    },
  };

  const docs = {
    async write(taskId: string, kind: DocKind, body: string) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const path = join(dir, `${kind}.md`);
        if (kind === "verification") {
          const prev = await readRecordOrNull(path, verificationSchema);
          const data: VerificationFrontmatter = prev?.data.result
            ? { result: prev.data.result }
            : {};
          await writeAtomic(path, stringifyRecord(data, body));
          return { kind, ...data, body };
        }
        const prev = await readRecordOrNull(path, pipelineDocSchema);
        const data: PipelineDocFrontmatter = prev
          ? { status: "draft", revision: prev.data.revision + 1 }
          : { status: "draft", revision: 1 };
        await writeAtomic(path, stringifyRecord(data, body));
        return { kind, ...data, body };
      });
    },

    async read(taskId: string, kind: DocKind) {
      const dir = await taskDir(taskId);
      const path = join(dir, `${kind}.md`);
      if (kind === "verification") {
        const rec = await readRecordOrNull(path, verificationSchema);
        return rec && { kind, ...rec.data, body: rec.body.trimStart() };
      }
      const rec = await readRecordOrNull(path, pipelineDocSchema);
      return rec && { kind, ...rec.data, body: rec.body.trimStart() };
    },

    async setStatus(taskId: string, kind: "spec" | "architecture", status: DocStatus) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const path = join(dir, `${kind}.md`);
        const rec = await readRecord(path, pipelineDocSchema);
        if (DOC_STATUS_RANK[status] <= DOC_STATUS_RANK[rec.data.status]) {
          throw new Error(`cannot move ${kind} status from ${rec.data.status} to ${status}`);
        }
        const patched = await patchRecord(path, pipelineDocSchema, (doc) => {
          doc.set("status", status);
        });
        return { kind, ...patched.data, body: patched.body.trimStart() };
      });
    },

    async setResult(taskId: string, kind: "verification", result: VerificationResult) {
      const dir = await taskDir(taskId);
      return withLock(dir, async () => {
        const path = join(dir, "verification.md");
        if ((await readOptional(path)) === null) {
          throw new Error(`verification.md missing for task ${taskId}`);
        }
        const patched = await patchRecord(path, verificationSchema, (doc) => {
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
        const data: SliceFrontmatter = { title, status: "todo" };
        const body = bodyWithSection(goal, "Criteria", criteria);
        await createExclusive(file, stringifyRecord(data, body));
        return toSlice(file, n, data, body);
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
        return toSlice(slice.file, n, rec.data, rec.body);
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
      const dir = await taskDir(taskId);
      const raw = await readOptional(join(dir, "notes.md"));
      if (raw === null) return [];
      const entries = parseNotes(raw);
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
      const raw = await readOptional(projectPath);
      if (raw === null) throw new Error(`missing ${projectPath}`);
      const { preamble, sections } = splitSections(raw);
      const idx = sections.findIndex((s) => s.heading === "Lessons");
      const lesson = `- ${text.trim()}`;
      if (idx === -1) {
        await writeAtomic(projectPath, `${raw.replace(/\s*$/, "")}\n\n## Lessons\n\n${lesson}\n`);
        return;
      }
      const lessons = sections[idx];
      if (!lessons) return;
      lessons.body = lessons.body ? `${lessons.body}\n${lesson}` : lesson;
      const chunks = sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}\n`);
      if (preamble.trim()) chunks.unshift(preamble.trimEnd());
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

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function readRecordOrNull<T>(path: string, schema: z.ZodType<T>) {
  try {
    return await readRecord(path, schema);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("missing file")) return null;
    throw err;
  }
}

async function listTasks(root: string, config: Config): Promise<TaskRecord[]> {
  const tasksDir = join(root, "tasks");
  const tasks: TaskRecord[] = [];
  for (const name of await listDir(tasksDir)) {
    if (name.startsWith(".")) continue;
    const dir = join(tasksDir, name);
    const rec = await readRecord(join(dir, "task.md"), taskSchema);
    tasks.push(toTask(dir, rec.data, rec.body));
  }
  const colIndex = (column: string) => {
    const i = config.columns.indexOf(column);
    return i === -1 ? config.columns.length : i;
  };
  tasks.sort(
    (a, b) =>
      colIndex(a.column) - colIndex(b.column) ||
      a.order.localeCompare(b.order) ||
      a.id.localeCompare(b.id),
  );
  return tasks;
}

async function listSlices(taskDirPath: string): Promise<SliceRecord[]> {
  const slicesDir = join(taskDirPath, "slices");
  const slices: SliceRecord[] = [];
  for (const name of await listDir(slicesDir)) {
    const match = name.match(/^(\d+)-.+\.md$/);
    if (!match?.[1]) continue;
    const file = join(slicesDir, name);
    const rec = await readRecord(file, sliceSchema);
    slices.push(toSlice(file, Number(match[1]), rec.data, rec.body));
  }
  slices.sort((a, b) => a.n - b.n);
  return slices;
}

function toTask(dir: string, data: TaskFrontmatter, body: string): TaskRecord {
  const { preamble, bullets } = parseBody(body, "Acceptance criteria");
  return { ...data, description: preamble, criteria: bullets, dir };
}

function toSlice(file: string, n: number, data: SliceFrontmatter, body: string): SliceRecord {
  const { preamble, bullets } = parseBody(body, "Criteria");
  return { ...data, n, goal: preamble, criteria: bullets, file };
}

function parseBody(body: string, heading: string): { preamble: string; bullets: string[] } {
  const { preamble, sections } = splitSections(body);
  const section = sections.find((s) => s.heading === heading);
  return { preamble, bullets: parseBullets(section?.body ?? "") };
}

function parseBullets(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+(?:\[.\]\s+)?(.*)$/);
    const text = match?.[1]?.trim();
    if (text) out.push(text);
  }
  return out;
}

function bodyWithSection(preamble: string, heading: string, bullets: string[]): string {
  const text = preamble.trim();
  if (bullets.length === 0) return text ? `${text}\n` : "";
  const list = bullets.map((b) => `- ${b}`).join("\n");
  return `${text}\n\n## ${heading}\n\n${list}\n`;
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

function parseNotes(raw: string): NoteEntry[] {
  const entries: NoteEntry[] = [];
  for (const section of splitSections(raw).sections) {
    const [at, author, target, ...rest] = section.heading.split(" · ").map((p) => p.trim());
    const parsed = noteEntrySchema.safeParse({
      at,
      author,
      target,
      verdict: rest.length > 0 ? rest.join(" · ") : undefined,
      body: section.body,
    });
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}
