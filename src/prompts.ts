import { parseYaml, splitFrontmatter } from "./store/index.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promptsDir } from "./paths.ts";

export const ROLES = [
  "planner",
  "critic",
  "reviewer",
  "user",
  "coder",
  "code-reviewer",
  "tester",
  "researcher",
  "polisher",
] as const;

export type Prompt = {
  role: (typeof ROLES)[number];
  model: string;
  readonly: boolean;
  body: string;
};

// Template names under prompts/<subdir>, keyed by their subdir-prefixed path (e.g. standards/spec).
async function names(subdir = ""): Promise<string[]> {
  return (await readdir(join(promptsDir, subdir)))
    .filter((name) => name.endsWith(".md"))
    .map((name) => subdir + name.slice(0, -".md".length))
    .sort();
}

export function actions(): Promise<string[]> {
  return names();
}

export async function templates(): Promise<string[]> {
  return [...(await actions()), ...(await names("standards/")), ...(await names("include/"))];
}

export function repoPath(root: string, action: string): string {
  return join(root, "prompts", `${action}.md`);
}

export async function resolve(root: string, action: string) {
  if (!(await templates()).includes(action)) throw new Error(`unknown action ${action}`);
  const repo = repoPath(root, action);
  if (await Bun.file(repo).exists()) return { source: "repo" as const, path: repo };
  return { source: "built-in" as const, path: join(promptsDir, `${action}.md`) };
}

export async function snippet(root: string, name: string): Promise<{ path: string; text: string }> {
  const { path } = await resolve(root, name);
  return { path, text: (await Bun.file(path).text()).trimEnd() };
}

export async function standard(root: string, name: "design" | "spec"): Promise<string> {
  return (await snippet(root, `standards/${name}`)).text;
}

export async function load(path: string): Promise<Prompt> {
  const { fm, body } = splitFrontmatter(await Bun.file(path).text());
  const data = (parseYaml(fm ?? "") ?? {}) as Record<string, unknown>;
  const model = typeof data.model === "string" ? data.model.trim() : "";
  if (!model) throw new Error(`missing model in ${path}`);
  const raw = String(data.role);
  const role = ROLES.find((r) => r === raw);
  if (!role) throw new Error(`invalid role ${raw}: expected ${ROLES.join("|")}`);
  return { role, model, readonly: data.readonly === true, body: body.trimStart() };
}

export function render(body: string, vars: Record<string, string>, file: string): string {
  return body.replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`unknown slot {{${key}}} in ${file}`);
    return value;
  });
}
