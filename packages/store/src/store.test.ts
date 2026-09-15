import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreError } from "./errors.ts";
import { Store } from "./store.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-store-"));
  dirs.push(dir);
  await Store.init(dir);
  const store = new Store(dir);
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
    const a = await store.createTask({
      title: "Ship store",
      description: "Own the files.",
      criteria: ["create a task", "move it"],
    });
    expect(a).toMatchObject({
      column: "backlog",
      criteria: ["create a task", "move it"],
    });
    expect(await store.getTask(a.id)).toMatchObject({ title: "Ship store" });

    const b = await store.createTask({ title: "Second", description: "Another" });
    expect((await store.listTasks()).map((t) => t.id)).toEqual([a.id, b.id]);

    await store.updateTask(a.id, { branch: "feat/store", description: "Updated." });
    const moved = await store.moveTask(a.id, "planning");
    expect(moved).toMatchObject({
      column: "planning",
      branch: "feat/store",
      description: "Updated.",
    });

    expect(freeze(await readFile(join(a.dir, "task.md"), "utf8"))).toMatchSnapshot();
  });

  test("get by unique prefix, suffix, or full id", async () => {
    const { store } = await setup();
    const a = await store.createTask({ title: "A", description: "a" });
    expect(await store.getTask(a.id.slice(0, 8))).toMatchObject({ id: a.id });
    expect(await store.getTask(a.id.slice(-12))).toMatchObject({ id: a.id });
    expect(await store.getTask(a.id)).toMatchObject({ id: a.id });
  });

  test("get rejects ambiguous and unknown refs and ignores dot entries", async () => {
    const { store } = await setup();
    const a = await store.createTask({ title: "A", description: "a" });
    await store.createTask({ title: "B", description: "b" });
    await mkdir(join(store.root, "tasks", ".lock"));
    await writeFile(join(store.root, "tasks", ".DS_Store"), "");
    const shared = a.id.slice(0, 8); // uuidv7 timestamp prefix common to both tasks
    await expect(store.getTask(shared)).rejects.toBeInstanceOf(StoreError);
    await expect(store.getTask(shared)).rejects.toMatchObject({
      code: "ambiguous_id",
      message: `ambiguous task id ${shared}`,
    });
    await expect(store.getTask("nope")).rejects.toBeInstanceOf(StoreError);
    await expect(store.getTask("nope")).rejects.toMatchObject({
      code: "not_found",
      message: "task nope not found",
    });
    await expect(store.getTask(".lock")).rejects.toThrow("task .lock not found");
    await expect(store.getTask("Store")).rejects.toThrow("task Store not found");
  });

  test("move with before/after", async () => {
    const { store } = await setup();
    const a = await store.createTask({ title: "A", description: "a" });
    const b = await store.createTask({ title: "B", description: "b" });
    const c = await store.createTask({ title: "C", description: "c" });
    await store.moveTask(c.id, "backlog", { after: a.id, before: b.id });
    expect((await store.listTasks()).map((t) => t.id)).toEqual([a.id, c.id, b.id]);
  });

  test("move with short ids", async () => {
    const { store } = await setup();
    const a = await store.createTask({ title: "A", description: "a" });
    const b = await store.createTask({ title: "B", description: "b" });
    const shortA = a.id.slice(-12);
    const shortB = b.id.slice(-12);
    await store.moveTask(shortA, "backlog", { after: shortB });
    expect((await store.listTasks()).map((t) => t.id)).toEqual([b.id, a.id]);
    await expect(store.moveTask(shortA, "backlog", { after: shortA })).rejects.toThrow(
      "not found in backlog",
    );
  });

  test("rejects an unknown column", async () => {
    const { store } = await setup();
    const a = await store.createTask({ title: "A", description: "a" });
    await expect(store.moveTask(a.id, "nope")).rejects.toThrow("unknown column");
  });
});

describe("docs slices notes project assets", () => {
  test("pipeline docs, slices, notes, project, assets", async () => {
    const { store } = await setup();
    const task = await store.createTask({
      title: "Board",
      description: "Kanban",
      criteria: ["renders"],
    });

    const spec = await store.writeDoc(task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(spec).toMatchObject({ status: "draft", revision: 1 });

    const rewrittenDraft = await store.writeDoc(task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(rewrittenDraft).toMatchObject({ status: "draft", revision: 2 });

    await store.setDocStatus(task.id, "spec", "critiqued");
    const rewrittenCritiqued = await store.writeDoc(task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(rewrittenCritiqued).toMatchObject({ status: "draft", revision: 3 });

    await store.setDocStatus(task.id, "spec", "critiqued");
    await store.setDocStatus(task.id, "spec", "reviewed");
    await store.setDocStatus(task.id, "spec", "approved");
    await expect(store.setDocStatus(task.id, "spec", "draft")).rejects.toThrow("cannot move");

    const rewritten = await store.writeDoc(task.id, "spec", "# Spec v2\n");
    expect(rewritten).toMatchObject({ status: "draft", revision: 4 });

    await store.writeDoc(task.id, "architecture", "# Arch\n");
    await store.setDocStatus(task.id, "architecture", "approved");

    const slice = await store.addSlice(task.id, {
      title: "Codec",
      goal: "Parse frontmatter.",
      criteria: ["round-trip YAML"],
    });
    expect(slice).toMatchObject({ n: 1, status: "todo" });
    await store.updateSlice(task.id, 1, { status: "done", commit: "abc123" });
    expect((await store.listSlices(task.id))[0]?.commit).toBe("abc123");

    const note = await store.addNote(task.id, {
      author: "human",
      target: "spec",
      verdict: "approved",
      body: "Looks good.",
    });
    expect(note.target).toBe("spec");
    expect((await store.listNotes(task.id, "spec")).length).toBe(1);

    await store.addNote(task.id, {
      author: "critic",
      target: "spec",
      body: "## Verdict\n\nholds\n\n## Alternatives considered\n\n- none",
    });
    const notes = await store.listNotes(task.id, "spec");
    expect(notes.length).toBe(2);
    expect(notes.at(-1)?.body).toBe("## Verdict\n\nholds\n\n## Alternatives considered\n\n- none");

    await store.writeDoc(task.id, "verification", "Ran the board.\n");
    await store.setVerificationResult(task.id, "pass");
    expect((await store.readDoc(task.id, "verification"))?.kind).toBe("verification");

    expect(await store.putAsset(task.id, "board.png", "fake-png")).toBe("assets/board.png");

    await store.addLesson("Always lock around RMW.");
    expect(await store.readProject()).toContain("Always lock around RMW.");

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
    const task = await store.createTask({ title: "Walk", description: "pipeline" });

    expect((await store.next(task.id)).action).toBe("write-spec");
    await store.writeDoc(task.id, "spec", "spec");
    expect((await store.next(task.id)).action).toBe("critique-spec");
    await store.addNote(task.id, {
      author: "critic",
      target: "spec",
      verdict: "better-design",
      body: "…",
    });
    expect(await store.next(task.id)).toMatchObject({
      action: "write-spec",
      reason: expect.stringContaining("sent back"),
    });
    await store.addNote(task.id, {
      author: "planner",
      target: "spec",
      verdict: "revised",
      body: "…",
    });
    expect((await store.next(task.id)).action).toBe("critique-spec");
    await store.setDocStatus(task.id, "spec", "critiqued");
    expect((await store.next(task.id)).action).toBe("review-spec");
    await store.addNote(task.id, {
      author: "reviewer",
      target: "spec",
      verdict: "needs-changes",
      body: "…",
    });
    expect((await store.next(task.id)).action).toBe("write-spec");
    await store.addNote(task.id, {
      author: "planner",
      target: "spec",
      verdict: "revised",
      body: "…",
    });
    expect((await store.next(task.id)).action).toBe("review-spec");
    await store.setDocStatus(task.id, "spec", "reviewed");
    expect((await store.next(task.id)).action).toBe("approve-spec");
    await store.setDocStatus(task.id, "spec", "approved");

    expect((await store.next(task.id)).action).toBe("write-architecture");
    await store.writeDoc(task.id, "architecture", "arch");
    expect((await store.next(task.id)).action).toBe("critique-architecture");
    await store.setDocStatus(task.id, "architecture", "critiqued");
    expect((await store.next(task.id)).action).toBe("review-architecture");
    await store.setDocStatus(task.id, "architecture", "reviewed");
    expect((await store.next(task.id)).action).toBe("approve-architecture");
    await store.setDocStatus(task.id, "architecture", "approved");

    expect((await store.next(task.id)).action).toBe("add-slice");
    await store.addSlice(task.id, { title: "One", goal: "g", criteria: ["c"] });
    expect((await store.next(task.id)).action).toBe("work-slice");
    await store.updateSlice(task.id, 1, { status: "review" });
    expect(await store.next(task.id)).toMatchObject({
      action: "review-slice",
      reason: "slice 1 is in review",
    });
    await store.addSlice(task.id, { title: "Two", goal: "g", criteria: ["c"] });
    await store.updateSlice(task.id, 2, { status: "doing" });
    expect((await store.next(task.id)).action).toBe("review-slice");
    // blocked beats review
    await store.updateSlice(task.id, 2, { status: "review" });
    await store.updateSlice(task.id, 1, { status: "blocked" });
    const blocked = await store.next(task.id);
    expect(blocked.action).toBe("unblock-slice");
    expect(blocked.blocked?.length).toBe(1);
    await store.updateSlice(task.id, 1, { status: "done" });
    await store.updateSlice(task.id, 2, { status: "done" });

    expect((await store.next(task.id)).action).toBe("write-verification");
    await store.writeDoc(task.id, "verification", "saw it");
    expect((await store.next(task.id)).action).toBe("run-verification");
    await store.setVerificationResult(task.id, "pass");
    expect(await store.next(task.id)).toMatchObject({ stage: "done", action: "none" });
  });
});

describe("watch", () => {
  test("receives an external change", async () => {
    const { store } = await setup();
    const task = await store.createTask({ title: "Watch me", description: "d" });
    const events: string[] = [];
    const stop = store.watch((event) => {
      events.push(event.file);
    });
    await Bun.sleep(50);
    const path = join(task.dir, "task.md");
    const current = await readFile(path, "utf8");
    await writeFile(path, `${current}\nextra\n`);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !events.some((f) => f.endsWith("task.md"))) {
      await Bun.sleep(50);
    }
    stop();
    expect(events.some((f) => f.endsWith("task.md"))).toBe(true);
  });
});

describe("Store", () => {
  test("throws when there is no .buildsmith", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsmith-none-"));
    dirs.push(dir);
    expect(() => new Store(dir)).toThrow("no .buildsmith");
  });

  test("config models round-trip", async () => {
    const { dir } = await setup();
    await writeFile(join(dir, ".buildsmith", "config.yml"), "models:\n  strong: my-strong\n");
    const store = new Store(dir);
    expect(store.config.models).toEqual({ strong: "my-strong" });
  });
});
