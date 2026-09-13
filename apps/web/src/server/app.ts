import { join, relative, resolve } from "node:path";
import { next, watch, type Store, type TaskRecord } from "@buildsmith/store";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

async function findTask(store: Store, id: string): Promise<TaskRecord | null> {
  try {
    return await store.tasks.get(id);
  } catch (err) {
    if (err instanceof Error && err.message.endsWith("not found")) return null;
    if (err instanceof Error && err.message.startsWith("ambiguous task id"))
      throw new HTTPException(400, { res: Response.json({ error: err.message }) });
    throw err;
  }
}

export function createApp(store: Store, distDir: string) {
  return new Hono()
    .get("/api/board", async (c) => {
      const list = await store.tasks.list();
      const tasks = await Promise.all(
        list.map(async (task) => ({ ...task, next: await next(store, task.id) })),
      );
      return c.json({ columns: store.config.columns, tasks });
    })
    .get("/api/tasks/:id", async (c) => {
      const task = await findTask(store, c.req.param("id"));
      if (!task) return c.json({ error: "task not found" }, 404);
      const [nextAction, spec, architecture, verification, slices, notes] = await Promise.all([
        next(store, task.id),
        store.docs.read(task.id, "spec"),
        store.docs.read(task.id, "architecture"),
        store.docs.read(task.id, "verification"),
        store.slices.list(task.id),
        store.notes.list(task.id),
      ]);
      return c.json({ task, next: nextAction, spec, architecture, verification, slices, notes });
    })
    .get("/api/*", (c) => c.json({ error: "not found" }, 404))
    .get("/events", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "ping", data: "" });
        const stop = watch(
          store.root,
          (e) => void stream.writeSSE({ event: "change", data: JSON.stringify(e) }),
        );
        stream.onAbort(stop);
        while (!stream.aborted && !stream.closed) {
          await stream.sleep(5000);
          await stream.writeSSE({ event: "ping", data: "" });
        }
      }),
    )
    .get("/tasks/:id/assets/:path{.+}", async (c) => {
      const id = c.req.param("id");
      const task = await findTask(store, id);
      if (!task) return c.json({ error: "task not found" }, 404);
      const assetsDir = join(task.dir, "assets");
      const file = resolve(assetsDir, c.req.param("path"));
      if (relative(assetsDir, file).startsWith("..")) {
        return c.json({ error: "forbidden" }, 403);
      }
      const f = Bun.file(file);
      if (!(await f.exists())) return c.json({ error: "not found" }, 404);
      return new Response(f);
    })
    .use("*", serveStatic({ root: distDir }));
}

export type AppType = ReturnType<typeof createApp>;
