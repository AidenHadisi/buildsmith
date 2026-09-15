import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@buildsmith/store";
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
  await Store.init(dir);
  const store = new Store(dir);
  const task = await store.createTask({
    title: "Board",
    description: "Kanban over .buildsmith.",
    criteria: ["renders"],
  });
  await store.writeDoc(task.id, "spec", "# Spec\n\nDo the thing.\n");
  await store.addSlice(task.id, { title: "One", goal: "g", criteria: ["c"] });
  await store.addNote(task.id, { author: "critic", target: "spec", body: "Tighten this." });
  await store.putAsset(task.id, "pixel.png", Buffer.from(PNG_1X1, "base64"));
  const distDir = join(dir, "dist");
  await mkdir(distDir, { recursive: true });
  return { store, task, distDir, app: createApp(store, distDir) };
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

  test("GET /api/tasks/:id 400s on an ambiguous id", async () => {
    const { app, store } = await setup();
    const other = await store.createTask({ title: "Other", description: "d" });
    const prefix = other.id.slice(0, 8);
    const res = await app.request(`/api/tasks/${prefix}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `ambiguous task id ${prefix}` });
  });

  test("GET /api/tasks/:id 500s on a corrupt task.md", async () => {
    const { app, task } = await setup();
    await writeFile(join(task.dir, "task.md"), "---\nnot: [valid\n---\n");
    const res = await app.request(`/api/tasks/${task.id}`);
    expect(res.status).toBe(500);
  });

  test("GET /api/* 404s unknown api routes as json, even with dist present", async () => {
    const { app, distDir } = await setup();
    await writeFile(join(distDir, "index.html"), "<h1>board</h1>");
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

  test("GET /tasks/:id/assets/* serves a nested asset path", async () => {
    const { app, task } = await setup();
    await mkdir(join(task.dir, "assets", "nested"));
    await writeFile(join(task.dir, "assets", "nested", "a.png"), Buffer.from(PNG_1X1, "base64"));
    const res = await app.request(`/tasks/${task.id}/assets/nested/a.png`);
    expect(res.status).toBe(200);
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

  test("GET / serves dist index.html as text/html", async () => {
    const { app, distDir } = await setup();
    await writeFile(join(distDir, "index.html"), "<h1>board</h1>");
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("GET /assets/a.js serves dist files as text/javascript", async () => {
    const { app, distDir } = await setup();
    await mkdir(join(distDir, "assets"));
    await writeFile(join(distDir, "assets", "a.js"), "console.log(1)");
    const res = await app.request("/assets/a.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  test("GET /nope 404s when dist has no match", async () => {
    const { app } = await setup();
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
