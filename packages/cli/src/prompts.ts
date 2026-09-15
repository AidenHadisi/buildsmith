import { parseYaml, splitFrontmatter } from "@buildsmith/store";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { asEnum } from "./io.ts";
import { promptsDir } from "./paths.ts";

export const ROLES = [
  "planner",
  "critic",
  "reviewer",
  "user",
  "coder",
  "code-reviewer",
  "tester",
] as const;

export type Prompt = {
  role: (typeof ROLES)[number];
  model: string;
  readonly: boolean;
  body: string;
};

export async function actions(): Promise<string[]> {
  const names = await readdir(promptsDir);
  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .sort();
}

export function repoPath(root: string, action: string): string {
  return join(root, "prompts", `${action}.md`);
}

export async function resolve(root: string, action: string) {
  if (!(await actions()).includes(action)) throw new Error(`unknown action ${action}`);
  const repo = repoPath(root, action);
  if (await Bun.file(repo).exists()) return { source: "repo" as const, path: repo };
  return { source: "built-in" as const, path: join(promptsDir, `${action}.md`) };
}

export async function load(path: string): Promise<Prompt> {
  const { fm, body } = splitFrontmatter(await Bun.file(path).text());
  const data = (fm === null ? {} : (parseYaml(fm) ?? {})) as Record<string, unknown>;
  const model = typeof data.model === "string" ? data.model.trim() : "";
  if (!model) throw new Error(`missing model in ${path}`);
  return {
    role: asEnum("role", String(data.role), ROLES),
    model,
    readonly: data.readonly === true,
    body: body.trimStart(),
  };
}

export function render(body: string, vars: Record<string, string>, file: string): string {
  return body.replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => slot(vars, key, file));
}

function slot(vars: Record<string, string>, key: string, file: string): string {
  const value = vars[key];
  if (value === undefined) throw new Error(`unknown slot {{${key}}} in ${file}`);
  return value;
}
