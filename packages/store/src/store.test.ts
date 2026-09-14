import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRoot } from "./files.ts";
import { next } from "./next.ts";
import { openStore } from "./store.ts";
import { watch } from "./watch.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-store-"));
  dirs.push(dir);
  await initRoot(dir);
  const store = await openStore(dir);
  return { dir, store };
}

function freeze(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<iso>")
    .replace(/\r\n/g, "\n");
}

describe("tasks", () => {
  test("create, get, list, update, move", async () => {
    const { store } = await setup();
    const a = await store.tasks.create({
      title: "Ship store",
      description: "Own the files.",
      criteria: ["create a task", "move it"],
    });
    expect(a.column).toBe("backlog");
    expect(a.criteria).toEqual(["create a task", "move it"]);
    expect(await store.tasks.get(a.id)).toMatchObject({ title: "Ship store" });

    const b = await store.tasks.create({
      title: "Second",
      description: "Another",
    });
    const listed = await store.tasks.list();
    expect(listed.map((t) => t.id)).toEqual([a.id, b.id]);

    await store.tasks.update(a.id, { branch: "feat/store", description: "Updated." });
    const moved = await store.tasks.move(a.id, "planning");
    expect(moved.column).toBe("planning");
    expect(moved.branch).toBe("feat/store");
    expect(moved.description).toBe("Updated.");

    expect(freeze(await readFile(join(a.dir, "task.md"), "utf8"))).toMatchSnapshot();
  });

  test("get by unique prefix, suffix, or full id", async () => {
    const { store } = await setup();
    const a = await store.tasks.create({ title: "A", description: "a" });
    expect(await store.tasks.get(a.id.slice(0, 8))).toMatchObject({ id: a.id });
    expect(await store.tasks.get(a.id.slice(-12))).toMatchObject({ id: a.id });
    expect(await store.tasks.get(a.id)).toMatchObject({ id: a.id });
  });

  test("get rejects ambiguous and unknown refs and ignores dot entries", async () => {
    const { store } = await setup();
    const a = await store.tasks.create({ title: "A", description: "a" });
    await store.tasks.create({ title: "B", description: "b" });
    await mkdir(join(store.root, "tasks", ".lock"));
    await writeFile(join(store.root, "tasks", ".DS_Store"), "");
    const shared = a.id.slice(0, 8); // uuidv7 timestamp prefix common to both tasks
    expect(store.tasks.get(shared)).rejects.toThrow(`ambiguous task id ${shared}`);
    expect(store.tasks.get("nope")).rejects.toThrow("task nope not found");
    expect(store.tasks.get(".lock")).rejects.toThrow("task .lock not found");
    expect(store.tasks.get("Store")).rejects.toThrow("task Store not found");
  });

  test("move with before/after", async () => {
    const { store } = await setup();
    const a = await store.tasks.create({ title: "A", description: "a" });
    const b = await store.tasks.create({ title: "B", description: "b" });
    const c = await store.tasks.create({ title: "C", description: "c" });
    await store.tasks.move(c.id, "backlog", { after: a.id, before: b.id });
    expect((await store.tasks.list()).map((t) => t.id)).toEqual([a.id, c.id, b.id]);
  });

  test("move with short ids", async () => {
    const { store } = await setup();
    const a = await store.tasks.create({ title: "A", description: "a" });
    const b = await store.tasks.create({ title: "B", description: "b" });
    const shortA = a.id.slice(-12);
    const shortB = b.id.slice(-12);
    await store.tasks.move(shortA, "backlog", { after: shortB });
    expect((await store.tasks.list()).map((t) => t.id)).toEqual([b.id, a.id]);
    expect(store.tasks.move(shortA, "backlog", { after: shortA })).rejects.toThrow(
      "not found in backlog",
    );
  });

  test("rejects an unknown column", async () => {
    const { store } = await setup();
    const a = await store.tasks.create({ title: "A", description: "a" });
    expect(store.tasks.move(a.id, "nope")).rejects.toThrow("unknown column");
  });
});

describe("docs slices notes project assets", () => {
  test("pipeline docs, slices, notes, project, assets", async () => {
    const { store } = await setup();
    const task = await store.tasks.create({
      title: "Board",
      description: "Kanban",
      criteria: ["renders"],
    });

    const spec = await store.docs.write(task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(spec.kind).toBe("spec");
    if (spec.kind !== "spec") throw new Error("expected spec");
    expect(spec.status).toBe("draft");
    expect(spec.revision).toBe(1);

    const rewrittenDraft = await store.docs.write(task.id, "spec", "# Spec\n\nDo the thing.\n");
    if (rewrittenDraft.kind !== "spec") throw new Error("expected spec");
    expect(rewrittenDraft.status).toBe("draft");
    expect(rewrittenDraft.revision).toBe(2);

    await store.docs.setStatus(task.id, "spec", "critiqued");
    const rewrittenCritiqued = await store.docs.write(task.id, "spec", "# Spec\n\nDo the thing.\n");
    if (rewrittenCritiqued.kind !== "spec") throw new Error("expected spec");
    expect(rewrittenCritiqued.status).toBe("draft");
    expect(rewrittenCritiqued.revision).toBe(3);

    await store.docs.setStatus(task.id, "spec", "critiqued");
    await store.docs.setStatus(task.id, "spec", "reviewed");
    await store.docs.setStatus(task.id, "spec", "approved");
    expect(store.docs.setStatus(task.id, "spec", "draft")).rejects.toThrow("cannot move");

    const rewritten = await store.docs.write(task.id, "spec", "# Spec v2\n");
    if (rewritten.kind !== "spec") throw new Error("expected spec");
    expect(rewritten.status).toBe("draft");
    expect(rewritten.revision).toBe(4);

    await store.docs.write(task.id, "architecture", "# Arch\n");
    await store.docs.setStatus(task.id, "architecture", "approved");

    const slice = await store.slices.add(task.id, {
      title: "Codec",
      goal: "Parse frontmatter.",
      criteria: ["round-trip YAML"],
    });
    expect(slice.n).toBe(1);
    expect(slice.status).toBe("todo");
    await store.slices.update(task.id, 1, { status: "done", commit: "abc123" });
    expect((await store.slices.list(task.id))[0]?.commit).toBe("abc123");

    const note = await store.notes.add(task.id, {
      author: "human",
      target: "spec",
      verdict: "approved",
      body: "Looks good.",
    });
    expect(note.target).toBe("spec");
    expect((await store.notes.list(task.id, "spec")).length).toBe(1);

    await store.notes.add(task.id, {
      author: "critic",
      target: "spec",
      body: "## Verdict\n\nholds\n\n## Alternatives considered\n\n- none",
    });
    const critique = (await store.notes.list(task.id, "spec")).at(-1);
    expect(critique?.body).toBe("## Verdict\n\nholds\n\n## Alternatives considered\n\n- none");
    expect((await store.notes.list(task.id, "spec")).length).toBe(2);

    await store.docs.write(task.id, "verification", "Ran the board.\n");
    await store.docs.setResult(task.id, "verification", "pass");
    expect((await store.docs.read(task.id, "verification"))?.kind).toBe("verification");

    const asset = await store.assets.put(task.id, "board.png", "fake-png");
    expect(asset).toBe("assets/board.png");

    await store.project.addLesson("Always lock around RMW.");
    const project = await store.project.read();
    expect(project).toContain("Always lock around RMW.");

    expect(freeze(await readFile(join(task.dir, "spec.md"), "utf8"))).toMatchSnapshot();
    expect(
      freeze(await readFile(join(task.dir, "slices", "01-codec.md"), "utf8")),
    ).toMatchSnapshot();
    expect(freeze(await readFile(join(task.dir, "notes.md"), "utf8"))).toMatchSnapshot();
    expect(freeze(await readFile(join(store.root, "project.md"), "utf8"))).toMatchSnapshot();
  });
});

describe("next", () => {
  test("walks the pipeline", async () => {
    const { store } = await setup();
    const task = await store.tasks.create({ title: "Walk", description: "pipeline" });

    expect((await next(store, task.id)).action).toBe("write-spec");
    await store.docs.write(task.id, "spec", "spec");
    expect((await next(store, task.id)).action).toBe("critique-spec");
    await store.notes.add(task.id, {
      author: "critic",
      target: "spec",
      verdict: "better-design",
      body: "…",
    });
    expect(await next(store, task.id)).toMatchObject({
      action: "write-spec",
      reason: expect.stringContaining("sent back"),
    });
    await store.notes.add(task.id, {
      author: "planner",
      target: "spec",
      verdict: "revised",
      body: "…",
    });
    expect((await next(store, task.id)).action).toBe("critique-spec");
    await store.docs.setStatus(task.id, "spec", "critiqued");
    expect((await next(store, task.id)).action).toBe("review-spec");
    await store.notes.add(task.id, {
      author: "reviewer",
      target: "spec",
      verdict: "needs-changes",
      body: "…",
    });
    expect((await next(store, task.id)).action).toBe("write-spec");
    await store.notes.add(task.id, {
      author: "planner",
      target: "spec",
      verdict: "revised",
      body: "…",
    });
    expect((await next(store, task.id)).action).toBe("review-spec");
    await store.docs.setStatus(task.id, "spec", "reviewed");
    expect((await next(store, task.id)).action).toBe("approve-spec");
    await store.docs.setStatus(task.id, "spec", "approved");

    expect((await next(store, task.id)).action).toBe("write-architecture");
    await store.docs.write(task.id, "architecture", "arch");
    expect((await next(store, task.id)).action).toBe("critique-architecture");
    await store.docs.setStatus(task.id, "architecture", "critiqued");
    expect((await next(store, task.id)).action).toBe("review-architecture");
    await store.docs.setStatus(task.id, "architecture", "reviewed");
    expect((await next(store, task.id)).action).toBe("approve-architecture");
    await store.docs.setStatus(task.id, "architecture", "approved");

    expect((await next(store, task.id)).action).toBe("add-slice");
    await store.slices.add(task.id, { title: "One", goal: "g", criteria: ["c"] });
    expect((await next(store, task.id)).action).toBe("work-slice");
    await store.slices.update(task.id, 1, { status: "review" });
    expect(await next(store, task.id)).toMatchObject({
      action: "review-slice",
      reason: "slice 1 is in review",
    });
    await store.slices.add(task.id, { title: "Two", goal: "g", criteria: ["c"] });
    await store.slices.update(task.id, 2, { status: "doing" });
    expect((await next(store, task.id)).action).toBe("review-slice");
    // blocked beats review
    await store.slices.update(task.id, 2, { status: "review" });
    await store.slices.update(task.id, 1, { status: "blocked" });
    const blocked = await next(store, task.id);
    expect(blocked.action).toBe("unblock-slice");
    expect(blocked.blocked?.length).toBe(1);
    await store.slices.update(task.id, 1, { status: "done" });
    await store.slices.update(task.id, 2, { status: "done" });

    expect((await next(store, task.id)).action).toBe("write-verification");
    await store.docs.write(task.id, "verification", "saw it");
    expect((await next(store, task.id)).action).toBe("run-verification");
    await store.docs.setResult(task.id, "verification", "pass");
    expect(await next(store, task.id)).toMatchObject({ stage: "done", action: "none" });
  });
});

describe("watch", () => {
  test("receives an external change", async () => {
    const { store } = await setup();
    const task = await store.tasks.create({ title: "Watch me", description: "d" });
    const events: string[] = [];
    const stop = watch(store.root, (event) => {
      events.push(event.file);
    });
    await Bun.sleep(50);
    const path = join(task.dir, "task.md");
    const current = await readFile(path, "utf8");
    await writeFile(path, `${current}\nextra\n`);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !events.some((f) => f.includes("task.md"))) {
      await Bun.sleep(50);
    }
    stop();
    expect(events.some((f) => f.endsWith("task.md"))).toBe(true);
  });
});

describe("openStore", () => {
  test("throws when there is no .buildsmith", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsmith-none-"));
    dirs.push(dir);
    expect(openStore(dir)).rejects.toThrow("no .buildsmith");
  });
});
