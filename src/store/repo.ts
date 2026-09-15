import { readFileSync, statSync, watch as fsWatch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { Document } from "yaml";
import * as z from "zod";
import { StoreError } from "./errors.ts";
import {
  BUILD_DIR,
  errCode,
  nonEmpty,
  parseYaml,
  readOptional,
  splitSections,
  wasSelfWrite,
  write,
} from "./files.ts";

const DEFAULT_COLUMNS = ["backlog", "planning", "building", "review", "done"] as const;

// Every key is optional per file; loadConfig layers built-in defaults, the user file, then the repo file.
const configSchema = z.object({
  columns: z.array(z.string()).min(1).optional(),
  models: z
    .object({ strong: z.string().min(1).optional(), fast: z.string().min(1).optional() })
    .optional(),
});
type ConfigLayer = z.infer<typeof configSchema>;
export type Config = { columns: string[]; models: { strong: string; fast: string } };

function userConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "buildsmith", "config.yml");
}

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
      new Document({ columns: [...DEFAULT_COLUMNS] }).toString(),
      { flag: "wx" },
    );
  } catch (err) {
    if (errCode(err) !== "EEXIST") throw err;
  }
  return root;
}

export function loadConfig(root: string): Config {
  const user = readConfigLayer(userConfigPath());
  const path = join(root, "config.yml");
  const repo = readConfigLayer(path);
  if (!repo) {
    throw new StoreError("invalid_input", `${path} is missing — run \`buildsmith init\``);
  }
  return {
    columns: repo.columns ?? user?.columns ?? [...DEFAULT_COLUMNS],
    models: {
      strong: repo.models?.strong ?? user?.models?.strong ?? "inherit",
      fast: repo.models?.fast ?? user?.models?.fast ?? "inherit",
    },
  };
}

function readConfigLayer(path: string): ConfigLayer | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (errCode(err) !== "ENOENT") throw err;
    return null;
  }
  const parsed = configSchema.safeParse(parseYaml(raw) ?? {});
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((i) => i.path.join(".") || "root").join(", ");
  throw new StoreError("invalid_input", `invalid ${path} (${fields})`, { cause: parsed.error });
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
  nonEmpty(body);
  await write(join(root, "project.md"), body.endsWith("\n") ? body : `${body}\n`);
}

export async function addLesson(root: string, text: string) {
  const path = join(root, "project.md");
  const lesson = `- ${nonEmpty(text).trim()}`;
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
