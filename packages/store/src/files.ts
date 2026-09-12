import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Document, parseDocument } from "yaml";
import type { z } from "zod";

const BUILD_DIR = ".buildsmith";

type Eol = "\n" | "\r\n";

type SplitFrontmatter = {
  bom: boolean;
  fm: string | null;
  body: string;
  eol: Eol;
};

type ReadRecord<T> = {
  data: T;
  body: string;
  doc: Document;
  eol: Eol;
  bom: boolean;
};

type Section = { heading: string; body: string };

const selfWrites = new Map<string, ReturnType<typeof Bun.hash>>();

export function wasSelfWrite(path: string, text: string): boolean {
  return selfWrites.get(resolve(path)) === Bun.hash(text);
}

export function splitFrontmatter(raw: string): SplitFrontmatter {
  const bom = raw.startsWith("\uFEFF");
  const s = bom ? raw.slice(1) : raw;
  const open = s.match(/^---\r?\n/);
  if (!open) return { bom, fm: null, body: s, eol: s.includes("\r\n") ? "\r\n" : "\n" };
  const rest = s.slice(open[0].length);
  const close = rest.match(/\r?\n---(?=\r?\n|$)/);
  if (!close || close.index == null) throw new Error("unclosed frontmatter");
  const fm = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  const eol: Eol = open[0].includes("\r") || fm.includes("\r\n") ? "\r\n" : "\n";
  return { bom, fm, body, eol };
}

export function joinFrontmatter(fm: string, body: string, eol: Eol = "\n", bom = false): string {
  let yamlOut = fm.replace(/\r\n/g, "\n");
  if (eol === "\r\n") yamlOut = yamlOut.replace(/\n/g, "\r\n");
  if (!yamlOut.endsWith(eol)) yamlOut += eol;
  const bodyOut = body.startsWith("\n") || body.startsWith("\r") ? body : `${eol}${body}`;
  return `${bom ? "\uFEFF" : ""}---${eol}${yamlOut}---${bodyOut}`;
}

export async function readRecord<T>(path: string, schema: z.ZodType<T>): Promise<ReadRecord<T>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (errCode(err) === "ENOENT") throw new Error(`missing file ${path}`, { cause: err });
    throw err;
  }
  const split = splitFrontmatter(raw);
  if (split.fm === null) throw new Error(`no frontmatter in ${path}`);
  const { data, doc } = parseDoc(path, schema, split.fm);
  return { data, body: split.body, doc, eol: split.eol, bom: split.bom };
}

export async function patchRecord<T>(
  path: string,
  schema: z.ZodType<T>,
  mutate: (doc: Document) => void,
): Promise<{ data: T; body: string }> {
  const rec = await readRecord(path, schema);
  mutate(rec.doc);
  const yamlOut = rec.doc.toString({ lineWidth: 0 });
  const { data } = parseDoc(path, schema, yamlOut);
  await writeAtomic(path, joinFrontmatter(yamlOut, rec.body, rec.eol, rec.bom));
  return { data, body: rec.body };
}

export function stringifyRecord(
  data: Record<string, unknown>,
  body: string,
  eol: Eol = "\n",
): string {
  const compact = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  return joinFrontmatter(new Document(compact).toString({ lineWidth: 0 }), body, eol);
}

export async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  await writeSynced(tmp, text, "w");
  await rename(tmp, path);
  selfWrites.set(resolve(path), Bun.hash(text));
}

export async function createExclusive(path: string, text: string): Promise<void> {
  try {
    await writeSynced(path, text, "wx");
  } catch (err) {
    if (errCode(err) === "EEXIST") throw new Error(`file exists ${path}`, { cause: err });
    throw err;
  }
  selfWrites.set(resolve(path), Bun.hash(text));
}

const STALE_MS = 10_000;
const RETRY_MS = 25;
const MAX_WAIT_MS = 5_000;

export async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(dir, ".lock");
  await mkdir(dir, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      if (errCode(err) !== "EEXIST") throw err;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // lock vanished
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        throw new Error(`timed out waiting for lock ${lockPath}`);
      }
      await Bun.sleep(RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export function splitSections(md: string): { preamble: string; sections: Section[] } {
  const lines = md.split(/\r?\n/);
  const sections: Section[] = [];
  const preamble: string[] = [];
  let heading: string | null = null;
  let body = preamble;
  let fence: { char: string; len: number } | null = null;

  for (const line of lines) {
    const marks = line.match(/^ {0,3}([`~]{3,})(.*)$/);
    if (fence) {
      const close = line.match(/^ {0,3}([`~]{3,})\s*$/);
      const run = close?.[1];
      if (run && run[0] === fence.char && run.length >= fence.len) fence = null;
      body.push(line);
      continue;
    }
    if (marks?.[1]) {
      fence = { char: marks[1][0] ?? "`", len: marks[1].length };
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

export async function findRoot(cwd: string): Promise<string | null> {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, BUILD_DIR);
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const DEFAULT_CONFIG_YAML = `columns:
  - backlog
  - planning
  - building
  - review
  - done
verify: ""
`;

const DEFAULT_PROJECT_MD = `## Run

## Check

## Live test

## Environment

## Data safety

## Lessons
`;

export async function initRoot(dir: string): Promise<string> {
  const root = join(resolve(dir), BUILD_DIR);
  await mkdir(join(root, "tasks"), { recursive: true });
  await writeIfMissing(join(root, "config.yml"), DEFAULT_CONFIG_YAML);
  await writeIfMissing(join(root, "project.md"), DEFAULT_PROJECT_MD);
  return root;
}

export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (errCode(err) === "ENOENT") return null;
    throw err;
  }
}

export function parseYaml(text: string): unknown {
  return parseDocument(text).toJS();
}

function parseDoc<T>(path: string, schema: z.ZodType<T>, yaml: string): { data: T; doc: Document } {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) {
    throw new Error(`invalid YAML in ${path}`, { cause: doc.errors[0] });
  }
  const parsed = schema.safeParse(doc.toJS() ?? {});
  if (!parsed.success) {
    throw new Error(`invalid frontmatter in ${path}: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return { data: parsed.data, doc };
}

async function writeSynced(path: string, text: string, flags: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, flags);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function writeIfMissing(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, { flag: "wx" });
  } catch (err) {
    if (errCode(err) !== "EEXIST") throw err;
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
