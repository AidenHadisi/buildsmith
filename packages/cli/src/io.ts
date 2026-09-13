import { openStore, type Store } from "@buildsmith/store";
import type { ArgsDef, CommandContext, ParsedArgs } from "citty";
import pc from "picocolors";

export const json = !process.stdout.isTTY || process.argv.includes("--json");
export const help = process.argv.some((arg) => arg === "--help" || arg === "-h");

export function act<T extends ArgsDef>(
  fn: (store: Store, args: ParsedArgs<T>) => Promise<unknown>,
): (context: CommandContext<T>) => Promise<void> {
  return async ({ args }) => {
    try {
      const store = await openStore(process.cwd());
      print(await fn(store, args));
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      console.error(json ? JSON.stringify({ error: err.message }) : err.message);
      process.exitCode = 1;
    }
  };
}

export function asEnum<T extends string>(name: string, value: string, options: readonly T[]): T {
  const match = options.find((option) => option === value);
  if (!match) throw new Error(`invalid ${name} ${value}: expected ${options.join("|")}`);
  return match;
}

export async function body(file?: string): Promise<string> {
  let text = "";
  if (file) text = await Bun.file(file).text();
  else if (!process.stdin.isTTY) text = await Bun.stdin.text();
  if (!text) throw new Error("empty body: provide --file or pipe a body on stdin");
  return text;
}

export function print(value: unknown) {
  if (value === undefined) return;
  if (json) return console.log(JSON.stringify(value, null, 2));
  if (value === null) return;
  if (typeof value === "string") return console.log(value);
  const records = Array.isArray(value) ? value : [value];
  for (const [i, record] of records.entries()) {
    if (i > 0) console.log();
    printRecord(record);
  }
}

function printRecord(record: object) {
  for (const [key, val] of Object.entries(record)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      line(key, val.every((v) => typeof v === "string") ? val.join(", ") : JSON.stringify(val));
    } else if (typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        if (v !== undefined && v !== null) line(`${key}.${k}`, v);
      }
    } else {
      line(key, val);
    }
  }
}

function line(key: string, val: unknown) {
  const text = typeof val === "object" ? JSON.stringify(val) : String(val);
  console.log(`${pc.dim(`${key}:`)}${text.includes("\n") ? "\n" : " "}${text}`);
}
