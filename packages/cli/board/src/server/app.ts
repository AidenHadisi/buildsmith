import { join, relative, resolve } from "node:path";
import { StoreError, type Store } from "@buildsmith/store";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";

export function createApp(store: Store, distDir: string) {
  return new Hono()
    .get("/api/board", async (c) => {
      const list = await store.listTasks();
      const tasks = await Promise.all(
        list.map(async (task) => ({ ...task, next: await store.next(task.id) })),
      );
      return c.json({ columns: store.config.columns, tasks });
    })
    .get("/api/tasks/:id", async (c) => {
      const task = await store.getTask(c.req.param("id"));
      const [nextAction, spec, architecture, verification, slices, notes] = await Promise.all([
        store.next(task.id),
        store.readDoc(task.id, "spec"),
        store.readDoc(task.id, "architecture"),
        store.readDoc(task.id, "verification"),
        store.listSlices(task.id),
        store.listNotes(task.id),
      ]);
      return c.json({ task, next: nextAction, spec, architecture, verification, slices, notes });
    })
    .get("/api/*", (c) => c.json({ error: "not found" }, 404))
    .get("/events", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "ping", data: "" });
        const stop = store.watch(
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
      const task = await store.getTask(c.req.param("id"));
      const assetsDir = join(task.dir, "assets");
      const file = resolve(assetsDir, c.req.param("path"));
      if (relative(assetsDir, file).startsWith("..")) {
        return c.json({ error: "forbidden" }, 403);
      }
      const f = Bun.file(file);
      if (!(await f.exists())) return c.json({ error: "not found" }, 404);
      return new Response(f);
    })
    .use("*", serveStatic({ root: distDir }))
    .onError((err, c) => {
      if (err instanceof StoreError && err.code === "not_found") {
        return c.json({ error: "task not found" }, 404);
      }
      if (err instanceof StoreError && err.code === "ambiguous_id") {
        return c.json({ error: err.message }, 400);
      }
      console.error(err);
      return c.text("Internal Server Error", 500);
    });
}

export type AppType = ReturnType<typeof createApp>;
