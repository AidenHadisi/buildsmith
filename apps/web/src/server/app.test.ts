import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRoot, openStore } from "@buildsmith/store";
import { createApp } from "./app.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// 1x1 transparent PNG.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-web-"));
  dirs.push(dir);
  await initRoot(dir);
  const store = await openStore(dir);
  const task = await store.tasks.create({
    title: "Board",
    description: "Kanban over .buildsmith.",
    criteria: ["renders"],
  });
  await store.docs.write(task.id, "spec", "# Spec\n\nDo the thing.\n");
  await store.slices.add(task.id, { title: "One", goal: "g", criteria: ["c"] });
  await store.notes.add(task.id, { author: "critic", target: "spec", body: "Tighten this." });
  await store.assets.put(task.id, "pixel.png", Buffer.from(PNG_1X1, "base64"));
  return { store, task, app: createApp(store) };
}

describe("app", () => {
  test("GET /api/board returns columns and tasks with next", async () => {
    const { app, task } = await setup();
    const res = await app.request("/api/board");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns).toEqual(["backlog", "planning", "building", "review", "done"]);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe(task.id);
    expect(body.tasks[0].next).toMatchObject({ stage: "spec", action: "critique-spec" });
  });

  test("GET /api/tasks/:id returns the full detail shape", async () => {
    const { app, task } = await setup();
    const res = await app.request(`/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.title).toBe("Board");
    expect(body.next.action).toBe("critique-spec");
    expect(body.spec).toMatchObject({ kind: "spec", status: "draft", revision: 1 });
    expect(body.architecture).toBeNull();
    expect(body.verification).toBeNull();
    expect(body.slices).toHaveLength(1);
    expect(body.notes).toHaveLength(1);
  });

  test("GET /api/tasks/:id 404s on an unknown task", async () => {
    const { app } = await setup();
    const res = await app.request("/api/tasks/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "task not found" });
  });

  test("GET /api/tasks/:id 500s on a corrupt task.md", async () => {
    const { app, task } = await setup();
    await writeFile(join(task.dir, "task.md"), "---\nnot: [valid\n---\n");
    const res = await app.request(`/api/tasks/${task.id}`);
    expect(res.status).toBe(500);
  });

  test("GET /api/* 404s unknown api routes as json", async () => {
    const { app } = await setup();
    const res = await app.request("/api/whatever");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  test("GET /tasks/:id/assets/* serves an asset with its content type", async () => {
    const { app, task } = await setup();
    const res = await app.request(`/tasks/${task.id}/assets/pixel.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  test("GET /tasks/:id/assets/* 403s on path traversal", async () => {
    const { app, task } = await setup();
    // A literal `..` is normalized away by the URL parser before routing; %2F survives.
    const res = await app.request(
      new Request(`http://x/tasks/${task.id}/assets/..%2F..%2Fconfig.yml`),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("GET /tasks/:id/assets/* 404s on a missing asset", async () => {
    const { app, task } = await setup();
    const res = await app.request(`/tasks/${task.id}/assets/nope.png`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  test("GET /tasks/:id/assets/* 404s on an unknown task", async () => {
    const { app } = await setup();
    const res = await app.request("/tasks/nope/assets/x.png");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "task not found" });
  });
});
