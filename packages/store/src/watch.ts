import { watch as fsWatch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { wasSelfWrite } from "./files.ts";
import { taskIdFromDir } from "./store.ts";

export type WatchEvent = { taskId?: string; file: string };

export function watch(root: string, onChange: (event: WatchEvent) => void): () => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const flush = async (abs: string) => {
    pending.delete(abs);
    try {
      const text = await readFile(abs, "utf8");
      if (wasSelfWrite(abs, text)) return;
    } catch {
      // deleted or unreadable — still emit
    }
    const file = relative(root, abs).replaceAll("\\", "/");
    const dir = file.match(/^tasks\/([^/]+)\//)?.[1];
    onChange({ taskId: dir ? taskIdFromDir(dir) : undefined, file });
  };

  const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const abs = join(root, filename.toString());
    if (abs.split(sep).includes(".lock") || basename(abs).endsWith(".tmp")) return;
    const prev = pending.get(abs);
    if (prev) clearTimeout(prev);
    pending.set(
      abs,
      setTimeout(() => void flush(abs), 100),
    );
  });

  return () => {
    watcher.close();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  };
}
