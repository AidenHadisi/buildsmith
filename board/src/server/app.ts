import { join, relative, resolve } from "node:path";
import {
  getTask,
  listNotes,
  listSlices,
  listTasks,
  loadConfig,
  readDoc,
  StoreError,
  watch,
} from "../../../src/store/index.ts";
import { next } from "../../../src/pipeline.ts";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";

export function createApp(root: string, distDir: string) {
  return new Hono()
    .get("/api/board", async (c) => {
      const list = await listTasks(root);
      const tasks = await Promise.all(
        list.map(async (task) => ({ ...task, next: await next(root, task.id) })),
      );
      return c.json({ columns: loadConfig(root).columns, tasks });
    })
    .get("/api/tasks/:id", async (c) => {
      const task = await getTask(root, c.req.param("id"));
      const [nextAction, spec, architecture, verification, slices, notes] = await Promise.all([
        next(root, task.id),
        readDoc(root, task.id, "spec"),
        readDoc(root, task.id, "architecture"),
        readDoc(root, task.id, "verification"),
        listSlices(root, task.id),
        listNotes(root, task.id),
      ]);
      return c.json({ task, next: nextAction, spec, architecture, verification, slices, notes });
    })
    .get("/api/*", (c) => c.json({ error: "not found" }, 404))
    .get("/events", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "ping", data: "" });
        const stop = watch(
          root,
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
      const task = await getTask(root, c.req.param("id"));
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
      if (err instanceof StoreError) {
        if (err.code === "not_found") return c.json({ error: "task not found" }, 404);
        return c.json({ error: err.message }, err.code === "conflict" ? 409 : 400);
      }
      console.error(err);
      return c.text("Internal Server Error", 500);
    });
}

export type AppType = ReturnType<typeof createApp>;
