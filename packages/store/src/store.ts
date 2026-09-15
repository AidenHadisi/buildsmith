import { generateKeyBetween } from "fractional-indexing";
import { readFileSync, watch as fsWatch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Document } from "yaml";
import { StoreError } from "./errors.ts";
import {
  BUILD_DIR,
  findRoot,
  listDir,
  parseYaml,
  readOptional,
  readRecord,
  record,
  slugify,
  splitSections,
  stringifyRecord,
  taskIdFromDir,
  wasSelfWrite,
  withLock,
  write,
  writeIfMissing,
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
export type WatchEvent = { taskId?: string; file: string };

export type NextAction = {
  stage: "spec" | "architecture" | "slicing" | "building" | "verify" | "done";
  action: string;
  reason: string;
  blocked?: SliceRecord[];
};

const DOC_STEPS = { draft: "critique", critiqued: "review", reviewed: "approve" } as const;
const NOTE_SEP = " · ";
const PROJECT_MD = `## Run

## Check

## Live test

## Environment

## Data safety

## Lessons
`;

function loadConfig(root: string): Config {
  let raw: string;
  try {
    raw = readFileSync(join(root, "config.yml"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return configSchema.parse({});
    throw err;
  }
  try {
    return configSchema.parse(parseYaml(raw) ?? {});
  } catch (err) {
    throw new Error("invalid config.yml", { cause: err });
  }
}

export class Store {
  readonly root: string;
  readonly config: Config;

  constructor(cwd: string) {
    const root = findRoot(cwd);
    if (root === null) throw new Error(`no .buildsmith directory from ${cwd}`);
    this.root = root;
    this.config = loadConfig(root);
  }

  static async init(dir: string): Promise<string> {
    const root = join(resolve(dir), BUILD_DIR);
    await mkdir(join(root, "tasks"), { recursive: true });
    await writeIfMissing(
      join(root, "config.yml"),
      new Document({ columns: [...DEFAULT_COLUMNS], verify: "" }).toString(),
    );
    await writeIfMissing(join(root, "project.md"), PROJECT_MD);
    return root;
  }

  get #tasks() {
    return join(this.root, "tasks");
  }

  get #project() {
    return join(this.root, "project.md");
  }

  #taskFile(dir: string) {
    return record(join(dir, "task.md"), taskSchema);
  }

  #docFile(dir: string, kind: DocKind) {
    return record(join(dir, `${kind}.md`), docSchema);
  }

  #asTask(rec: { data: TaskFrontmatter; body: string }, dir: string): TaskRecord {
    return { ...rec.data, description: rec.body.trim(), dir };
  }

  #asSlice(rec: { data: SliceFrontmatter; body: string }, n: number, file: string): SliceRecord {
    return { ...rec.data, n, goal: rec.body.trim(), file };
  }

  #asDoc<K extends DocKind>(
    kind: K,
    rec: { data: DocFrontmatter; body: string },
  ): TaskDoc & { kind: K } {
    return { kind, ...rec.data, body: rec.body.trimStart() };
  }

  async next(taskId: string): Promise<NextAction> {
    await this.#taskDir(taskId);

    for (const kind of ["spec", "architecture"] as const) {
      const step = await this.#docStep(taskId, kind, await this.readDoc(taskId, kind));
      if (step) return step;
    }

    const slices = await this.listSlices(taskId);
    if (slices.length === 0) {
      return { stage: "slicing", action: "add-slice", reason: "no slices yet" };
    }

    const blocked = slices.filter((s) => s.status === "blocked");
    const first = blocked[0];
    if (first) {
      return {
        stage: "building",
        action: "unblock-slice",
        reason: `slice ${first.n} is blocked`,
        blocked,
      };
    }

    const reviewing = slices.find((s) => s.status === "review");
    if (reviewing) {
      return {
        stage: "building",
        action: "review-slice",
        reason: `slice ${reviewing.n} is in review`,
      };
    }

    const unfinished = slices.find((s) => s.status !== "done");
    if (unfinished) {
      return {
        stage: "building",
        action: "work-slice",
        reason: `slice ${unfinished.n} is ${unfinished.status}`,
      };
    }

    const verification = await this.readDoc(taskId, "verification");
    if (!verification) {
      return {
        stage: "verify",
        action: "write-verification",
        reason: "verification does not exist",
      };
    }
    if (verification.result !== "pass") {
      return {
        stage: "verify",
        action: "run-verification",
        reason:
          verification.result === "fail" ? "verification failed" : "verification has no result",
      };
    }

    return { stage: "done", action: "none", reason: "all pipeline steps complete" };
  }

  async #docStep(
    taskId: string,
    kind: "spec" | "architecture",
    doc: TaskDoc | null,
  ): Promise<NextAction | null> {
    if (!doc?.status) {
      return { stage: kind, action: `write-${kind}`, reason: `${kind} does not exist` };
    }
    if (doc.status === "approved") return null;
    const verdict = (await this.listNotes(taskId, kind)).at(-1)?.verdict;
    if (verdict === "better-design" || verdict === "needs-changes") {
      return { stage: kind, action: `write-${kind}`, reason: `${kind} sent back: ${verdict}` };
    }
    return {
      stage: kind,
      action: `${DOC_STEPS[doc.status]}-${kind}`,
      reason: `${kind} is ${doc.status}`,
    };
  }

  watch(onChange: (event: WatchEvent) => void): () => void {
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const watcher = fsWatch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const name = filename.toString();
      if (name.endsWith(".lock")) return;
      const abs = join(this.root, name);
      const prev = pending.get(abs);
      if (prev) clearTimeout(prev);
      pending.set(
        abs,
        setTimeout(() => {
          pending.delete(abs);
          void (async () => {
            try {
              if (wasSelfWrite(abs, await readFile(abs, "utf8"))) return;
            } catch {
              // deleted or unreadable — still emit
            }
            const file = relative(this.root, abs).replaceAll("\\", "/");
            const dir = file.match(/^tasks\/([^/]+)\//)?.[1];
            onChange({ taskId: dir ? taskIdFromDir(dir) : undefined, file });
          })();
        }, 100),
      );
    });
    return () => {
      watcher.close();
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }

  async #taskDir(ref: string): Promise<string> {
    const names = await listDir(this.#tasks);
    const matches = names.filter((name) => {
      if (name.startsWith(".")) return false;
      const id = taskIdFromDir(name);
      return id === ref || id.startsWith(ref) || id.endsWith(ref);
    });
    const [match] = matches;
    if (!match) throw new StoreError("not_found", `task ${ref} not found`);
    if (matches.length > 1) throw new StoreError("ambiguous_id", `ambiguous task id ${ref}`);
    return join(this.#tasks, match);
  }

  async createTask(input: { title: string; description: string; criteria?: string[] }) {
    const { title, description, criteria = [] } = input;
    return withLock(this.#tasks, async () => {
      const column = this.config.columns[0] ?? DEFAULT_COLUMNS[0];
      const existing = await this.listTasks();
      const last = existing.findLast((t) => t.column === column);
      const now = new Date().toISOString();
      const data = {
        id: Bun.randomUUIDv7(),
        title,
        column,
        order: generateKeyBetween(last?.order ?? null, null),
        criteria: criteria.length ? criteria : undefined,
        createdAt: now,
        updatedAt: now,
      };
      const dir = join(this.#tasks, `${data.id}-${slugify(title)}`);
      await mkdir(join(dir, "assets"), { recursive: true });
      await this.#taskFile(dir).create(data, `${description.trim()}\n`);
      return { ...data, criteria, description: description.trim(), dir };
    });
  }

  async getTask(id: string) {
    const dir = await this.#taskDir(id);
    return this.#asTask(await this.#taskFile(dir).require(), dir);
  }

  async listTasks() {
    const listed: TaskRecord[] = [];
    for (const name of await listDir(this.#tasks)) {
      if (name.startsWith(".")) continue;
      const dir = join(this.#tasks, name);
      listed.push(this.#asTask(await this.#taskFile(dir).require(), dir));
    }
    const rank = (column: string) => {
      const i = this.config.columns.indexOf(column);
      return i === -1 ? this.config.columns.length : i;
    };
    listed.sort(
      (a, b) =>
        rank(a.column) - rank(b.column) ||
        a.order.localeCompare(b.order) ||
        a.id.localeCompare(b.id),
    );
    return listed;
  }

  async moveTask(id: string, column: string, pos: { before?: string; after?: string } = {}) {
    if (!this.config.columns.includes(column)) {
      throw new Error(`unknown column ${column}`);
    }
    const dir = await this.#taskDir(id);
    const afterDir = pos.after ? await this.#taskDir(pos.after) : undefined;
    const beforeDir = pos.before ? await this.#taskDir(pos.before) : undefined;
    return withLock(this.#tasks, async () => {
      const others = (await this.listTasks())
        .filter((t) => t.dir !== dir && t.column === column)
        .sort((a, b) => a.order.localeCompare(b.order) || a.id.localeCompare(b.id));
      const anchorDir = beforeDir ?? afterDir;
      const i = anchorDir ? others.findIndex((t) => t.dir === anchorDir) : others.length;
      if (anchorDir && i === -1) {
        throw new Error(`task ${pos.before ?? pos.after} not found in ${column}`);
      }
      const at = pos.before ? i : i + (pos.after ? 1 : 0);
      const order = generateKeyBetween(others[at - 1]?.order ?? null, others[at]?.order ?? null);
      const rec = await this.#taskFile(dir).patch((doc) => {
        doc.set("column", column);
        doc.set("order", order);
        doc.set("updatedAt", new Date().toISOString());
      });
      return this.#asTask(rec, dir);
    });
  }

  async updateTask(
    id: string,
    patch: {
      title?: string;
      description?: string;
      criteria?: string[];
      branch?: string;
      pr?: string;
    },
  ) {
    const dir = await this.#taskDir(id);
    const rec = await this.#taskFile(dir).patch(
      (doc) => {
        if (patch.title !== undefined) doc.set("title", patch.title);
        if (patch.branch !== undefined) doc.set("branch", patch.branch);
        if (patch.pr !== undefined) doc.set("pr", patch.pr);
        if (patch.criteria !== undefined) doc.set("criteria", patch.criteria);
        doc.set("updatedAt", new Date().toISOString());
      },
      patch.description === undefined ? undefined : `${patch.description.trim()}\n`,
    );
    return this.#asTask(rec, dir);
  }

  async writeDoc<K extends DocKind>(taskId: string, kind: K, body: string) {
    const path = join(await this.#taskDir(taskId), `${kind}.md`);
    let data: DocFrontmatter = {};
    await write(path, async (raw) => {
      const prev = raw === null ? undefined : (await readRecord(path, docSchema))?.data;
      if (kind === "verification") {
        data = prev?.result ? { result: prev.result } : {};
      } else {
        data = { status: "draft", revision: (prev?.revision ?? 0) + 1 };
      }
      return stringifyRecord(data, body);
    });
    return { kind, ...data, body };
  }

  async readDoc(taskId: string, kind: DocKind) {
    const rec = await this.#docFile(await this.#taskDir(taskId), kind).read();
    return rec && this.#asDoc(kind, rec);
  }

  async setDocStatus(taskId: string, kind: "spec" | "architecture", status: DocStatus) {
    const file = this.#docFile(await this.#taskDir(taskId), kind);
    const rec = await file.require();
    const current = rec.data.status;
    if (
      current &&
      docStatusSchema.options.indexOf(status) <= docStatusSchema.options.indexOf(current)
    ) {
      throw new Error(`cannot move ${kind} status from ${current} to ${status}`);
    }
    return this.#asDoc(kind, await file.patch((doc) => doc.set("status", status)));
  }

  async setVerificationResult(taskId: string, result: VerificationResult) {
    const file = this.#docFile(await this.#taskDir(taskId), "verification");
    return this.#asDoc("verification", await file.patch((doc) => doc.set("result", result)));
  }

  async addSlice(taskId: string, input: { title: string; goal: string; criteria: string[] }) {
    const { title, goal, criteria } = input;
    const dir = await this.#taskDir(taskId);
    return withLock(dir, async () => {
      const slicesDir = join(dir, "slices");
      await mkdir(slicesDir, { recursive: true });
      const existing = await this.listSlices(taskId);
      const n = (existing.at(-1)?.n ?? 0) + 1;
      const file = join(slicesDir, `${String(n).padStart(2, "0")}-${slugify(title)}.md`);
      const data = {
        title,
        status: "todo" as const,
        criteria: criteria.length ? criteria : undefined,
      };
      await record(file, sliceSchema).create(data, `${goal.trim()}\n`);
      return { ...data, criteria, n, goal: goal.trim(), file };
    });
  }

  async listSlices(taskId: string) {
    const slicesDir = join(await this.#taskDir(taskId), "slices");
    const slices: SliceRecord[] = [];
    for (const name of await listDir(slicesDir)) {
      const n = Number(name.match(/^(\d+)-.+\.md$/)?.[1]);
      if (!n) continue;
      const file = join(slicesDir, name);
      slices.push(this.#asSlice(await record(file, sliceSchema).require(), n, file));
    }
    return slices.sort((a, b) => a.n - b.n);
  }

  async updateSlice(taskId: string, n: number, patch: { status?: SliceStatus; commit?: string }) {
    const slice = (await this.listSlices(taskId)).find((s) => s.n === n);
    if (!slice) throw new Error(`slice ${n} not found on task ${taskId}`);
    const rec = await record(slice.file, sliceSchema).patch((doc) => {
      if (patch.status !== undefined) doc.set("status", patch.status);
      if (patch.commit !== undefined) doc.set("commit", patch.commit);
    });
    return this.#asSlice(rec, n, slice.file);
  }

  async addNote(
    taskId: string,
    input: { author: string; target: string; verdict?: string; body: string },
  ) {
    const { author, target, verdict, body } = input;
    const path = join(await this.#taskDir(taskId), "notes.md");
    const entry = noteEntrySchema.parse({
      at: new Date().toISOString(),
      author,
      target,
      verdict,
      body: body.trim(),
    });
    const heading = [entry.at, entry.author, entry.target, entry.verdict]
      .filter(Boolean)
      .join(NOTE_SEP);
    const section = `## ${heading}\n\n${entry.body}\n`;
    await write(path, (existing) => {
      const cur = existing ?? "";
      return cur.trim() ? `${cur.replace(/\s*$/, "")}\n\n${section}` : section;
    });
    return entry;
  }

  async listNotes(taskId: string, target?: string) {
    const raw = await readOptional(join(await this.#taskDir(taskId), "notes.md"));
    if (raw === null) return [];
    // Only headings that start with a timestamp open a note; any other `##` belongs to the body.
    const grouped: { heading: string; body: string }[] = [];
    for (const section of splitSections(raw).sections) {
      const last = grouped.at(-1);
      if (/^\d{4}-\d{2}-\d{2}T/.test(section.heading) || !last) grouped.push({ ...section });
      else last.body = `${last.body}\n\n## ${section.heading}\n\n${section.body}`.trim();
    }
    const entries: NoteEntry[] = [];
    for (const section of grouped) {
      const [at, author, targetName, ...rest] = section.heading
        .split(NOTE_SEP)
        .map((p) => p.trim());
      const parsed = noteEntrySchema.safeParse({
        at,
        author,
        target: targetName,
        verdict: rest.length > 0 ? rest.join(NOTE_SEP) : undefined,
        body: section.body,
      });
      if (parsed.success) entries.push(parsed.data);
    }
    return target ? entries.filter((e) => e.target === target) : entries;
  }

  async readProject() {
    const raw = await readOptional(this.#project);
    if (raw === null) throw new Error(`missing ${this.#project}`);
    return raw;
  }

  async writeProject(body: string) {
    await write(this.#project, body.endsWith("\n") ? body : `${body}\n`);
  }

  async addLesson(text: string) {
    const lesson = `- ${text.trim()}`;
    await write(this.#project, (raw) => {
      if (raw === null) throw new Error(`missing ${this.#project}`);
      const { preamble, sections } = splitSections(raw);
      const lessons = sections.find((s) => s.heading === "Lessons");
      if (!lessons) {
        return `${raw.replace(/\s*$/, "")}\n\n## Lessons\n\n${lesson}\n`;
      }
      lessons.body = lessons.body ? `${lessons.body}\n${lesson}` : lesson;
      const chunks = [
        ...(preamble.trim() ? [preamble.trimEnd()] : []),
        ...sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}\n`),
      ];
      return chunks.join("\n").replace(/\n*$/, "\n");
    });
  }

  async putAsset(taskId: string, name: string, bytes: Uint8Array | string) {
    const dir = await this.#taskDir(taskId);
    const safe = basename(name);
    if (!safe || safe === "." || safe === "..") {
      throw new Error(`invalid asset name ${name}`);
    }
    const rel = join("assets", safe);
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, rel), bytes);
    return rel.replaceAll("\\", "/");
  }
}
