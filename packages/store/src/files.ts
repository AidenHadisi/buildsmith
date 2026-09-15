import { statSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Document, parse, parseDocument } from "yaml";
import type { z } from "zod";

export const BUILD_DIR = ".buildsmith";

const UUID_LEN = 36;
const STALE_MS = 10_000;
const RETRY_MS = 25;
const MAX_WAIT_MS = 5_000;

const selfWrites = new Map<string, ReturnType<typeof Bun.hash>>();

export function wasSelfWrite(path: string, text: string): boolean {
  return selfWrites.get(resolve(path)) === Bun.hash(text);
}

export function parseYaml(text: string): unknown {
  return parse(text);
}

export function splitFrontmatter(raw: string): { fm: string | null; body: string } {
  const s = raw.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (!s.startsWith("---\n")) return { fm: null, body: s };
  const rest = s.slice(4);
  const close = rest.search(/\n---(?=\n|$)/);
  if (close === -1) throw new Error("unclosed frontmatter");
  return { fm: rest.slice(0, close), body: rest.slice(close + "\n---".length) };
}

function joinFrontmatter(fm: string, body: string): string {
  const yamlOut = fm.endsWith("\n") ? fm : `${fm}\n`;
  return `---\n${yamlOut}---${body.startsWith("\n") ? body : `\n${body}`}`;
}

export function stringifyRecord(data: Record<string, unknown>, body: string): string {
  return joinFrontmatter(new Document(data).toString({ lineWidth: 0 }), body);
}

function parseDoc<T>(path: string, schema: z.ZodType<T>, yaml: string) {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) throw new Error(`invalid YAML in ${path}`, { cause: doc.errors[0] });
  const parsed = schema.safeParse(doc.toJS() ?? {});
  if (!parsed.success) {
    throw new Error(`invalid frontmatter in ${path}: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return { data: parsed.data, doc };
}

function fromRaw<T>(path: string, schema: z.ZodType<T>, raw: string) {
  const split = splitFrontmatter(raw);
  if (split.fm === null) throw new Error(`no frontmatter in ${path}`);
  return { ...parseDoc(path, schema, split.fm), body: split.body };
}

export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (errCode(err) === "ENOENT") return null;
    throw err;
  }
}

export async function readRecord<T>(path: string, schema: z.ZodType<T>) {
  const raw = await readOptional(path);
  return raw === null ? null : fromRaw(path, schema, raw);
}

async function waitFor<T>(lock: string, attempt: () => Promise<T>): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      if (errCode(err) !== "EEXIST") throw err;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > STALE_MS) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        // vanished
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        throw new Error(`timed out waiting for lock ${lock}`);
      }
      await Bun.sleep(RETRY_MS);
    }
  }
}

/** Git-style lockfile: write to `path.lock` with O_EXCL, then rename over `path`. */
export async function write(
  path: string,
  next: string | ((cur: string | null) => string | Promise<string>),
  exclusive = false,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const text = await waitFor(lock, async () => {
    const fh = await open(lock, "wx");
    try {
      const cur = await readOptional(path);
      if (exclusive && cur !== null) throw new Error(`file exists ${path}`);
      const out = typeof next === "function" ? await next(cur) : next;
      await fh.writeFile(out);
      await fh.sync();
      await fh.close();
      await rename(lock, path);
      return out;
    } catch (err) {
      await fh.close().catch(() => {});
      await rm(lock, { force: true });
      throw err;
    }
  });
  selfWrites.set(resolve(path), Bun.hash(text));
}

export async function writeIfMissing(path: string, text: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { flag: "wx" });
  } catch (err) {
    if (errCode(err) !== "EEXIST") throw err;
  }
}

export async function patchRecord<T>(
  path: string,
  schema: z.ZodType<T>,
  mutate: (doc: Document) => void,
  body?: string,
): Promise<{ data: T; body: string }> {
  let result: { data: T; body: string } | undefined;
  await write(path, (raw) => {
    if (raw === null) throw new Error(`missing file ${path}`);
    const rec = fromRaw(path, schema, raw);
    mutate(rec.doc);
    const yamlOut = rec.doc.toString({ lineWidth: 0 });
    const { data } = parseDoc(path, schema, yamlOut);
    const nextBody = body ?? rec.body;
    result = { data, body: nextBody };
    return joinFrontmatter(yamlOut, nextBody);
  });
  return result!;
}

export function record<T>(path: string, schema: z.ZodType<T>) {
  return {
    read: () => readRecord(path, schema),
    async require() {
      const rec = await readRecord(path, schema);
      if (!rec) throw new Error(`missing file ${path}`);
      return rec;
    },
    patch: (mutate: (doc: Document) => void, body?: string) =>
      patchRecord(path, schema, mutate, body),
    create: (data: Record<string, unknown>, body: string) =>
      write(path, stringifyRecord(data, body), true),
  };
}

export async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(dir, ".lock");
  await mkdir(dir, { recursive: true });
  await waitFor(lock, () => mkdir(lock));
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

type Section = { heading: string; body: string };

export function splitSections(md: string): { preamble: string; sections: Section[] } {
  const lines = md.split(/\r?\n/);
  const sections: Section[] = [];
  const preamble: string[] = [];
  let heading: string | null = null;
  let body = preamble;
  let fence: string | null = null;

  for (const line of lines) {
    if (fence) {
      const run = line.match(/^ {0,3}([`~]{3,})\s*$/)?.[1];
      if (run && run[0] === fence[0] && run.length >= fence.length) fence = null;
      body.push(line);
      continue;
    }
    const open = line.match(/^ {0,3}([`~]{3,})/)?.[1];
    if (open) {
      fence = open;
      body.push(line);
      continue;
    }
    const next = line.match(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (next?.[1]) {
      if (heading !== null) sections.push({ heading, body: trimSectionBody(body) });
      heading = next[1].trim();
      body = [];
      continue;
    }
    body.push(line);
  }
  if (heading !== null) sections.push({ heading, body: trimSectionBody(body) });
  return { preamble: trimSectionBody(preamble), sections };
}

export function findRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, BUILD_DIR);
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function taskIdFromDir(dirName: string): string {
  return dirName.slice(0, UUID_LEN);
}

export function slugify(title: string, max = 48): string {
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

export async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if (errCode(err) === "ENOENT") return [];
    throw err;
  }
}

function trimSectionBody(lines: string[]): string {
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}
