import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRoot, openStore } from "@buildsmith/store";
import { print } from "./io.ts";

const main = join(import.meta.dir, "main.ts");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(args: string[], opts: { cwd: string; stdin?: string }) {
  const proc = Bun.spawn(["bun", main, ...args], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function tmp() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-cli-"));
  dirs.push(dir);
  return dir;
}

async function setup() {
  const dir = await tmp();
  await initRoot(dir);
  const store = await openStore(dir);
  const a = await store.tasks.create({ title: "Task A", description: "First" });
  const b = await store.tasks.create({ title: "Task B", description: "Second" });
  return { dir, a, b };
}

describe("help", () => {
  test("root --help lists init, next, task and --json", async () => {
    const { stdout, code } = await run(["--help"], { cwd: await tmp() });
    expect(code).toBe(0);
    expect(stdout).toContain("USAGE");
    expect(stdout).toContain("init");
    expect(stdout).toContain("next");
    expect(stdout).toContain("task");
    expect(stdout).toContain("--json");
  });

  test("task --help lists create, list, get, move, update", async () => {
    const { stdout, code } = await run(["task", "--help"], { cwd: await tmp() });
    expect(code).toBe(0);
    for (const sub of ["create", "list", "get", "move", "update"]) {
      expect(stdout).toContain(sub);
    }
  });

  test("task get --help documents the id argument", async () => {
    const { stdout, code } = await run(["task", "get", "--help"], { cwd: await tmp() });
    expect(code).toBe(0);
    expect(stdout).toContain("ID");
  });
});

describe("usage errors", () => {
  test("unknown command prints usage to stderr and exits 1", async () => {
    const { stdout, stderr, code } = await run(["bogus"], { cwd: await tmp() });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("USAGE");
    expect(stderr).toContain("Unknown command");
    expect(stderr).not.toMatch(/^\s+at /m);
  });

  test("missing positional prints usage to stderr and exits 1", async () => {
    const { stderr, code } = await run(["task", "get"], { cwd: await tmp() });
    expect(code).toBe(1);
    expect(stderr).toContain("USAGE");
    expect(stderr).toContain("Missing required positional");
    expect(stderr).not.toMatch(/^\s+at /m);
  });
});

describe("task commands", () => {
  test("task list prints JSON with column and next.stage", async () => {
    const { dir } = await setup();
    const { stdout, code } = await run(["task", "list"], { cwd: dir });
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].column).toBe("backlog");
    expect(tasks[0].next.stage).toBe("spec");
  });

  test("--json works before and after the subcommand", async () => {
    const { dir } = await setup();
    for (const args of [
      ["--json", "task", "list"],
      ["task", "list", "--json"],
    ]) {
      const { stdout, code } = await run(args, { cwd: dir });
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toBeArray();
    }
  });

  test("ambiguous short id prints one stderr line and exits 1", async () => {
    const { dir, a } = await setup();
    const ref = a.id.slice(0, 8);
    for (const args of [
      ["task", "get", ref],
      ["--json", "task", "get", ref],
    ]) {
      const { stdout, stderr, code } = await run(args, { cwd: dir });
      expect(code).toBe(1);
      expect(stdout).toBe("");
      const err = stderr.trim();
      expect(err.split("\n")).toHaveLength(1);
      expect(JSON.parse(err).error).toBe(`ambiguous task id ${ref}`);
    }
  });

  test("unknown short id prints one stderr line and exits 1", async () => {
    const { dir } = await setup();
    const { stderr, code } = await run(["task", "get", "nope"], { cwd: dir });
    expect(code).toBe(1);
    const err = stderr.trim();
    expect(err.split("\n")).toHaveLength(1);
    expect(JSON.parse(err).error).toBe("task nope not found");
  });

  test("init, create, move, update, get round-trip in a temp repo", async () => {
    const dir = await tmp();
    const init = await run(["init"], { cwd: dir });
    expect(init.code).toBe(0);
    // macOS temp dirs are symlinked (/var -> /private/var); the spawned process reports the real path
    expect(JSON.parse(init.stdout)).toBe(await realpath(join(dir, ".buildsmith")));
    await stat(join(dir, ".buildsmith", "project.md"));

    const created = await run(["task", "create", "--title", "X", "c1", "c2"], { cwd: dir });
    expect(created.code).toBe(0);
    const task = JSON.parse(created.stdout);
    expect(task.criteria).toEqual(["c1", "c2"]);

    const moved = await run(["task", "move", task.id, "planning"], { cwd: dir });
    expect(moved.code).toBe(0);
    expect(JSON.parse(moved.stdout).column).toBe("planning");

    const updated = await run(["task", "update", task.id, "--branch", "b"], { cwd: dir });
    expect(updated.code).toBe(0);

    const got = await run(["task", "get", task.id.slice(0, 8)], { cwd: dir });
    expect(got.code).toBe(0);
    const full = JSON.parse(got.stdout);
    expect(full.column).toBe("planning");
    expect(full.branch).toBe("b");
    expect(full.criteria).toEqual(["c1", "c2"]);
  });
});

describe("print", () => {
  test("prints nothing for undefined or null", () => {
    const calls: unknown[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      print(undefined);
      print(null);
    } finally {
      console.log = original;
    }
    expect(calls).toEqual([]);
  });
});
