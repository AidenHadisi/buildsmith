import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";
import { next } from "../pipeline.ts";
import { StoreError } from "./errors.ts";
import { record } from "./files.ts";
import {
  addLesson,
  addNote,
  addSlice,
  createTask,
  findRoot,
  getTask,
  init,
  listNotes,
  listSlices,
  listTasks,
  loadConfig,
  parseSlices,
  putAsset,
  projectHasContent,
  readDoc,
  readProject,
  setDocStatus,
  setVerificationResult,
  updateSlice,
  updateTask,
  watch,
  writeDoc,
  writeProject,
} from "./index.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const PROJECT = `## Run

- bun test

## Lessons
`;

const ARCH = `# Arch

## Slices

### Codec

Parse frontmatter.

**Criteria:**

- round-trip YAML
`;

const ARCH_TWO = `# Arch

## Slices

### 1. One

First goal

1.1 Build the first piece in its file.

**Criteria:**

- first works

**Tests:**

- first piece works end to end

### 2. Two

Second goal

**Criteria:**

- second works
`;

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-store-"));
  dirs.push(dir);
  const root = await init(dir);
  await writeProject(root, PROJECT);
  return { dir, root };
}

function freeze(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<iso>")
    .replace(/\r\n/g, "\n");
}

// Raw task.md access, bypassing the task schema so tests can plant any frontmatter.
const taskMd = (dir: string) => record(join(dir, "task.md"), z.looseObject({}));

describe("tasks", () => {
  test("create, get, list, update", async () => {
    const { root } = await setup();
    const a = await createTask(root, { title: "Ship store", description: "Own the files." });
    expect(a).toMatchObject({ id: "ship-store" });
    expect(await getTask(root, a.id)).toMatchObject({ title: "Ship store" });

    const b = await createTask(root, { title: "Second", description: "Another" });
    await taskMd(a.dir).patch({ updatedAt: "2026-01-01T00:00:00.000Z" });
    await taskMd(b.dir).patch({ updatedAt: "2026-01-02T00:00:00.000Z" });
    expect((await listTasks(root)).map((t) => t.id)).toEqual([b.id, a.id]);

    await updateTask(root, a.id, { branch: "feat/store", description: "Updated." });
    await taskMd(a.dir).patch({ updatedAt: "2026-01-03T00:00:00.000Z" });
    expect((await listTasks(root)).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(a.dir).toBe(join(root, "tasks", "ship-store"));
    expect(freeze(await readFile(join(a.dir, "task.md"), "utf8"))).toBe(`---
id: ship-store
title: Ship store
createdAt: <iso>
updatedAt: <iso>
branch: feat/store
---
Updated.
`);
  });

  test("get by unique prefix or full id", async () => {
    const { root } = await setup();
    const a = await createTask(root, { title: "Invoice PDF", description: "a" });
    expect(a.id).toBe("invoice-pdf");
    expect(await getTask(root, "invoice")).toMatchObject({ id: a.id });
    expect(await getTask(root, a.id)).toMatchObject({ id: a.id });
  });

  test("explicit id is the folder name and does not follow the title", async () => {
    const { root } = await setup();
    const a = await createTask(root, {
      id: "invoices-pdf",
      title: "Invoice PDF export",
      description: "a",
    });
    expect(a.id).toBe("invoices-pdf");
    expect(a.dir).toBe(join(root, "tasks", "invoices-pdf"));
    await expect(
      createTask(root, { id: "invoices-pdf", title: "Other", description: "b" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "task invoices-pdf already exists",
    });
  });

  test("an exact id wins over a longer prefix match", async () => {
    const { root } = await setup();
    await createTask(root, { id: "web", title: "Web", description: "a" });
    await createTask(root, { id: "web-board", title: "Web board", description: "b" });
    expect((await getTask(root, "web")).id).toBe("web");
    expect((await getTask(root, "web-b")).id).toBe("web-board");
  });

  test("get rejects ambiguous and unknown refs and ignores dot entries", async () => {
    const { root } = await setup();
    await createTask(root, { title: "Task A", description: "a" });
    await createTask(root, { title: "Task B", description: "b" });
    await mkdir(join(root, "tasks", ".lock"));
    await writeFile(join(root, "tasks", ".DS_Store"), "");
    await expect(getTask(root, "task")).rejects.toBeInstanceOf(StoreError);
    await expect(getTask(root, "task")).rejects.toMatchObject({
      code: "ambiguous_id",
      message: "ambiguous task id task",
    });
    await expect(getTask(root, "nope")).rejects.toBeInstanceOf(StoreError);
    await expect(getTask(root, "nope")).rejects.toMatchObject({
      code: "not_found",
      message: "task nope not found",
    });
    await expect(getTask(root, ".lock")).rejects.toThrow("task .lock not found");
    await expect(getTask(root, "Store")).rejects.toThrow("task Store not found");
  });

  test("getTask reads a task.md with stale column and order", async () => {
    const { root } = await setup();
    const dir = join(root, "tasks", "stale-task");
    await mkdir(dir, { recursive: true });
    await taskMd(dir).create(
      {
        id: "stale-task",
        title: "Stale",
        column: "backlog",
        order: "a0",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      "old files still parse.\n",
    );
    await expect(getTask(root, "stale-task")).resolves.toMatchObject({
      id: "stale-task",
      title: "Stale",
    });
  });
});

describe("docs slices notes project assets", () => {
  test("pipeline docs, slices, notes, project, assets", async () => {
    const { root } = await setup();
    const task = await createTask(root, {
      title: "Board",
      description: "Kanban",
    });

    const spec = await writeDoc(root, task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(spec).toMatchObject({ status: "draft", revision: 1 });

    const rewrittenDraft = await writeDoc(root, task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(rewrittenDraft).toMatchObject({ status: "draft", revision: 2 });

    await setDocStatus(root, task.id, "spec", "critiqued");
    const rewrittenCritiqued = await writeDoc(root, task.id, "spec", "# Spec\n\nDo the thing.\n");
    expect(rewrittenCritiqued).toMatchObject({ status: "draft", revision: 3 });

    await setDocStatus(root, task.id, "spec", "critiqued");
    await setDocStatus(root, task.id, "spec", "reviewed");
    await setDocStatus(root, task.id, "spec", "approved");
    await expect(setDocStatus(root, task.id, "spec", "draft")).rejects.toThrow("cannot move");

    const rewritten = await writeDoc(root, task.id, "spec", "# Spec v2\n");
    expect(rewritten).toMatchObject({ status: "draft", revision: 4 });

    await writeDoc(root, task.id, "architecture", ARCH);
    await setDocStatus(root, task.id, "architecture", "approved");

    const slice = (await listSlices(root, task.id))[0];
    expect(slice).toMatchObject({ n: 1, title: "Codec", status: "todo" });
    await updateSlice(root, task.id, 1, { status: "done", commit: "abc123" });
    expect((await listSlices(root, task.id))[0]?.commit).toBe("abc123");

    const note = await addNote(root, task.id, {
      author: "human",
      target: "spec",
      verdict: "approved",
      body: "Looks good.",
    });
    expect(note.target).toBe("spec");
    expect((await listNotes(root, task.id, "spec")).length).toBe(1);

    await addNote(root, task.id, {
      author: "critic",
      target: "spec",
      body: "## Verdict\n\nholds\n\n## Alternatives considered\n\n- none",
    });
    const notes = await listNotes(root, task.id, "spec");
    expect(notes.length).toBe(2);
    expect(notes.at(-1)?.body).toBe("## Verdict\n\nholds\n\n## Alternatives considered\n\n- none");

    await writeDoc(root, task.id, "verification", "Ran the board.\n");
    await setVerificationResult(root, task.id, "pass");
    expect((await readDoc(root, task.id, "verification"))?.kind).toBe("verification");

    expect(await putAsset(root, task.id, "board.png", "fake-png")).toBe("assets/board.png");

    await addLesson(root, "Always lock around RMW.");
    expect(await readProject(root)).toContain("Always lock around RMW.");

    expect(freeze(await readFile(join(task.dir, "spec.md"), "utf8"))).toBe(`---
status: draft
revision: 4
---
# Spec v2
`);
    expect(freeze(await readFile(join(task.dir, "slices", "01-codec.md"), "utf8"))).toBe(`---
title: Codec
status: done
criteria:
  - round-trip YAML
commit: abc123
---
Parse frontmatter.
`);
    const notesDir = join(task.dir, "notes");
    const noteFiles = (await readdir(notesDir)).filter((name) => name.endsWith(".md")).sort();
    expect(noteFiles).toHaveLength(2);
    const noteTexts = await Promise.all(
      noteFiles.map((name) => readFile(join(notesDir, name), "utf8")),
    );
    expect(freeze(noteTexts.join("\n"))).toBe(`---
at: <iso>
author: human
target: spec
verdict: approved
---
Looks good.

---
at: <iso>
author: critic
target: spec
---
## Verdict

holds

## Alternatives considered

- none
`);
    expect(freeze(await readFile(join(root, "project.md"), "utf8"))).toBe(`## Run

- bun test

## Lessons

- Always lock around RMW.
`);
  });
});

describe("parseSlices", () => {
  const CONTRACTS_ARCH = `# Arch

## Slices

### 1. Persist widgets

Add the widget table and repository in the store component.

1.1 Add the table in \`src/store/widgets.ts\`.

\`\`\`ts
export function addWidget(root: string, input: { name: string }): Promise<Widget>;
// - looks like a bullet but is inside a fence
\`\`\`

1.2 Add the repository, rejecting empty names with \`invalid\`.

**Criteria:**

- \`bun test\` includes a passing widgets test

- Adding a widget with an empty name throws \`invalid\`

**Tests:**

- adds a widget and lists it
- rejects an empty name

### 2. Expose the endpoint

Serve widgets over HTTP.

Criteria:

- GET /widgets lists them
`;

  test("parses numbered slices, ignoring fences, sub-steps, and other labels", () => {
    expect(parseSlices(CONTRACTS_ARCH)).toEqual([
      {
        title: "Persist widgets",
        goal: "Add the widget table and repository in the store component.",
        criteria: [
          "`bun test` includes a passing widgets test",
          "Adding a widget with an empty name throws `invalid`",
        ],
      },
      {
        title: "Expose the endpoint",
        goal: "Serve widgets over HTTP.",
        criteria: ["GET /widgets lists them"],
      },
    ]);
  });

  test("throws naming the slice when the goal or Criteria is missing", () => {
    const noGoal = "## Slices\n\n### Widgets\n\n**Criteria:**\n\n- works\n";
    expect(() => parseSlices(noGoal)).toThrow('slice "Widgets" has no goal');
    const subStepFirst =
      "## Slices\n\n### Widgets\n\n1.1 Add the table.\n\n**Criteria:**\n\n- works\n";
    expect(() => parseSlices(subStepFirst)).toThrow('slice "Widgets" has no goal');
    const noCriteria = "## Slices\n\n### Widgets\n\nAdd widgets.\n";
    expect(() => parseSlices(noCriteria)).toThrow('slice "Widgets" has no criteria');
  });

  test("throws when there is no Slices section", () => {
    expect(() => parseSlices("# Arch\n\nNo slices here.\n")).toThrow(
      "architecture has no ## Slices section with at least one slice",
    );
  });

  test("approving an architecture without slices fails and leaves the status unchanged", async () => {
    const { root } = await setup();
    const task = await createTask(root, { title: "Bad arch", description: "d" });
    await writeDoc(root, task.id, "architecture", "# Arch\n\nNo slices here.\n");
    await expect(setDocStatus(root, task.id, "architecture", "approved")).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect((await readDoc(root, task.id, "architecture"))?.status).toBe("draft");
    expect(await listSlices(root, task.id)).toHaveLength(0);
  });

  test("approving when slices already exist keeps the existing ones", async () => {
    const { root } = await setup();
    const task = await createTask(root, { title: "Reseed", description: "d" });
    await addSlice(root, task.id, { title: "Manual", goal: "g", criteria: ["c"] });
    await writeDoc(root, task.id, "architecture", ARCH_TWO);
    await setDocStatus(root, task.id, "architecture", "approved");
    expect((await listSlices(root, task.id)).map((s) => s.title)).toEqual(["Manual"]);
  });
});

describe("next", () => {
  test("write-project until project.md has content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsmith-store-"));
    dirs.push(dir);
    const root = await init(dir);
    const task = await createTask(root, { title: "Walk", description: "pipeline" });
    expect(await next(root, task.id)).toMatchObject({
      stage: "project",
      action: "write-project",
    });
    await writeProject(root, "## Run\n\n## Check\n");
    expect((await next(root, task.id)).action).toBe("write-project");
    await writeProject(root, PROJECT);
    expect((await next(root, task.id)).action).toBe("write-spec");
  });

  test("walks the pipeline", async () => {
    const { root } = await setup();
    const task = await createTask(root, { title: "Walk", description: "pipeline" });

    expect((await next(root, task.id)).action).toBe("write-spec");
    await writeDoc(root, task.id, "spec", "spec");
    expect((await next(root, task.id)).action).toBe("review-spec");
    await addNote(root, task.id, {
      author: "reviewer",
      target: "spec",
      verdict: "better-design",
      body: "…",
    });
    expect(await next(root, task.id)).toMatchObject({
      action: "write-spec",
      reason: expect.stringContaining("sent back"),
    });
    await addNote(root, task.id, {
      author: "planner",
      target: "spec",
      verdict: "revised",
      body: "…",
    });
    expect((await next(root, task.id)).action).toBe("review-spec");
    await addNote(root, task.id, {
      author: "reviewer",
      target: "spec",
      verdict: "needs-changes",
      body: "…",
    });
    expect((await next(root, task.id)).action).toBe("write-spec");
    await addNote(root, task.id, {
      author: "planner",
      target: "spec",
      verdict: "revised",
      body: "…",
    });
    expect((await next(root, task.id)).action).toBe("review-spec");
    await setDocStatus(root, task.id, "spec", "reviewed");
    expect((await next(root, task.id)).action).toBe("approve-spec");
    await setDocStatus(root, task.id, "spec", "approved");

    expect((await next(root, task.id)).action).toBe("write-architecture");
    await writeDoc(root, task.id, "architecture", ARCH_TWO);
    expect((await next(root, task.id)).action).toBe("review-architecture");
    await setDocStatus(root, task.id, "architecture", "reviewed");
    expect((await next(root, task.id)).action).toBe("approve-architecture");
    await setDocStatus(root, task.id, "architecture", "approved");

    const seeded = await listSlices(root, task.id);
    expect(seeded.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(seeded[0]).toMatchObject({ n: 1, goal: "First goal", criteria: ["first works"] });
    expect(seeded[1]).toMatchObject({ n: 2, goal: "Second goal", criteria: ["second works"] });
    expect((await next(root, task.id)).action).toBe("work-slice");
    await updateSlice(root, task.id, 1, { status: "review" });
    expect(await next(root, task.id)).toMatchObject({
      action: "work-slice",
      reason: "slice 1 is review",
    });
    await updateSlice(root, task.id, 2, { status: "doing" });
    expect((await next(root, task.id)).action).toBe("work-slice");
    await updateSlice(root, task.id, 2, { status: "review" });
    await updateSlice(root, task.id, 1, { status: "blocked" });
    const blocked = await next(root, task.id);
    expect(blocked.action).toBe("unblock-slice");
    expect(blocked.blocked?.length).toBe(1);
    await updateSlice(root, task.id, 1, { status: "done" });
    await updateSlice(root, task.id, 2, { status: "done" });

    expect((await next(root, task.id)).action).toBe("polish");
    await addNote(root, task.id, {
      author: "polisher",
      target: "polish",
      verdict: "done",
      body: "None.",
    });
    expect((await next(root, task.id)).action).toBe("review-branch");
    await addNote(root, task.id, {
      author: "code-reviewer",
      target: "branch",
      verdict: "revise",
      body: "…",
    });
    expect((await next(root, task.id)).action).toBe("work-branch");
    await addNote(root, task.id, {
      author: "coder",
      target: "branch",
      verdict: "done",
      body: "…",
    });
    expect((await next(root, task.id)).action).toBe("polish");
    await addNote(root, task.id, {
      author: "polisher",
      target: "polish",
      verdict: "done",
      body: "None.",
    });
    expect((await next(root, task.id)).action).toBe("review-branch");
    await addNote(root, task.id, {
      author: "code-reviewer",
      target: "branch",
      verdict: "pass",
      body: "Findings: None.",
    });
    expect((await next(root, task.id)).action).toBe("run-verification");
    await writeDoc(root, task.id, "verification", "saw it");
    expect((await next(root, task.id)).reason).toBe("verification has no result");
    await setVerificationResult(root, task.id, "pass");
    expect(await next(root, task.id)).toMatchObject({ stage: "done", action: "none" });
  });
});

describe("watch", () => {
  test("receives an external change", async () => {
    const { root } = await setup();
    const task = await createTask(root, { title: "Watch me", description: "d" });
    const events: string[] = [];
    const stop = watch(root, (event) => {
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

describe("repo", () => {
  test("projectHasContent rejects empty headings", () => {
    expect(projectHasContent(null)).toBe(false);
    expect(projectHasContent("")).toBe(false);
    expect(projectHasContent("## Run\n\n## Check\n")).toBe(false);
    expect(projectHasContent("## Run\n\n- bun test\n")).toBe(true);
    expect(projectHasContent("A CLI for the board.\n")).toBe(true);
  });

  test("throws when there is no .buildsmith", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsmith-none-"));
    dirs.push(dir);
    expect(() => findRoot(dir)).toThrow("no .buildsmith");
  });

  test("config layers built-in defaults, the user file, then the repo file", async () => {
    const { root } = await setup();
    const xdg = await mkdtemp(join(tmpdir(), "buildsmith-xdg-"));
    dirs.push(xdg);
    process.env.XDG_CONFIG_HOME = xdg;

    expect(loadConfig(root)).toEqual({
      models: { strong: "inherit", fast: "inherit" },
    });

    const user = join(xdg, "buildsmith", "config.yml");
    await mkdir(join(xdg, "buildsmith"));
    await writeFile(user, "models:\n  fast: user-fast\n");
    expect(loadConfig(root)).toEqual({
      models: { strong: "inherit", fast: "user-fast" },
    });

    await writeFile(join(root, "config.yml"), "models:\n  strong: repo-strong\n");
    expect(loadConfig(root)).toEqual({
      models: { strong: "repo-strong", fast: "user-fast" },
    });

    await writeFile(user, "models: [bad]\n");
    expect(() => loadConfig(root)).toThrow(`invalid ${user} (models)`);
  });
});
