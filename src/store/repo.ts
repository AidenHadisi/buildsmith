import { readFileSync, statSync, watch as fsWatch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Document } from "yaml";
import * as z from "zod";
import { StoreError } from "./errors.ts";
import {
  BUILD_DIR,
  errCode,
  parseYaml,
  readOptional,
  splitSections,
  wasSelfWrite,
  write,
} from "./files.ts";

const DEFAULT_COLUMNS = ["backlog", "planning", "building", "review", "done"] as const;
const DEFAULT_MODELS = { strong: "claude-opus-4.6", fast: "gemini-3.5-flash" } as const;

const configSchema = z.looseObject({
  columns: z
    .array(z.string())
    .min(1)
    .default([...DEFAULT_COLUMNS]),
  models: z
    .object({
      strong: z.string().default(DEFAULT_MODELS.strong),
      fast: z.string().default(DEFAULT_MODELS.fast),
    })
    .default(DEFAULT_MODELS),
});
export type Config = z.infer<typeof configSchema>;

export type WatchEvent = { taskId?: string; file: string };

export function findRoot(cwd = process.cwd()): string {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, BUILD_DIR);
    if (statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new StoreError(
        "not_found",
        `no .buildsmith directory from ${cwd} — run \`buildsmith init\``,
      );
    }
    dir = parent;
  }
}

export async function init(dir: string): Promise<string> {
  const root = join(resolve(dir), BUILD_DIR);
  await mkdir(join(root, "tasks"), { recursive: true });
  try {
    await writeFile(
      join(root, "config.yml"),
      new Document({ columns: [...DEFAULT_COLUMNS], models: { ...DEFAULT_MODELS } }).toString(),
      { flag: "wx" },
    );
  } catch (err) {
    if (errCode(err) !== "EEXIST") throw err;
  }
  return root;
}

export function loadConfig(root: string): Config {
  let raw: string;
  try {
    raw = readFileSync(join(root, "config.yml"), "utf8");
  } catch (err) {
    if (errCode(err) === "ENOENT") return configSchema.parse({});
    throw err;
  }
  try {
    return configSchema.parse(parseYaml(raw) ?? {});
  } catch (err) {
    throw new StoreError("invalid_input", "invalid config.yml", { cause: err });
  }
}

export function watch(root: string, onChange: (event: WatchEvent) => void): () => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = filename.toString();
    if (name.endsWith(".lock")) return;
    const abs = join(root, name);
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
          const file = relative(root, abs).replaceAll("\\", "/");
          const dir = file.match(/^tasks\/([^/]+)\//)?.[1];
          onChange({ taskId: dir, file });
        })();
      }, 100),
    );
  });
  return () => {
    watcher.close();
    for (const timer of pending.values()) clearTimeout(timer);
  };
}

export function projectHasContent(raw: string | null): boolean {
  if (raw == null || !raw.trim()) return false;
  const { preamble, sections } = splitSections(raw);
  return Boolean(preamble.trim()) || sections.some((s) => s.body.trim());
}

export async function isProjectReady(root: string): Promise<boolean> {
  return projectHasContent(await readOptional(join(root, "project.md")));
}

export async function readProject(root: string) {
  const path = join(root, "project.md");
  const raw = await readOptional(path);
  if (raw === null) throw new StoreError("not_found", `missing ${path}`);
  return raw;
}

export async function writeProject(root: string, body: string) {
  await write(join(root, "project.md"), body.endsWith("\n") ? body : `${body}\n`);
}

export async function addLesson(root: string, text: string) {
  const path = join(root, "project.md");
  const lesson = `- ${text.trim()}`;
  await write(path, (raw) => {
    if (raw === null) throw new StoreError("not_found", `missing ${path}`);
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
