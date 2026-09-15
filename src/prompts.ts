import { parseYaml, splitFrontmatter } from "./store/index.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promptsDir } from "./paths.ts";

// `run: self` steps are done by the main agent; `run: dispatch` steps go to a subagent.
export type Prompt =
  | { run: "self"; body: string }
  | { run: "dispatch"; model: string; readonly: boolean; body: string };

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
  const text = body.trimStart();
  if (data.run === "self") return { run: "self", body: text };
  if (data.run !== "dispatch")
    throw new Error(`invalid run ${data.run} in ${path}: expected self|dispatch`);
  const model = typeof data.model === "string" ? data.model.trim() : "";
  if (!model) throw new Error(`missing model in ${path}`);
  return { run: "dispatch", model, readonly: data.readonly === true, body: text };
}

export function render(body: string, vars: Record<string, string>, file: string): string {
  return body.replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`unknown slot {{${key}}} in ${file}`);
    return value;
  });
}
