import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRoot, openStore } from "@buildsmith/store";
import { json, print } from "./io.ts";

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

describe("doc commands", () => {
  test("doc write from --file and stdin produce byte-identical spec.md", async () => {
    const { dir, a, b } = await setup();
    const content = "# Spec\n\nByte identical body.\n";
    await Bun.write(join(dir, "f.md"), content);

    const fromFile = await run(["doc", "write", a.id, "spec", "--file", "f.md"], { cwd: dir });
    expect(fromFile.code).toBe(0);
    const fromStdin = await run(["doc", "write", b.id, "spec"], { cwd: dir, stdin: content });
    expect(fromStdin.code).toBe(0);

    const store = await openStore(dir);
    const specA = join((await store.tasks.get(a.id)).dir, "spec.md");
    const specB = join((await store.tasks.get(b.id)).dir, "spec.md");
    expect(await Bun.file(specB).text()).toBe(await Bun.file(specA).text());
  });

  test("doc write with neither --file nor a piped body fails with empty body", async () => {
    const { dir, a } = await setup();
    const { stderr, code } = await run(["doc", "write", a.id, "spec"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("empty body");
  });

  test("doc read before any write prints null and exits 0", async () => {
    const { dir, a } = await setup();
    const { stdout, code } = await run(["doc", "read", a.id, "spec"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("null");
  });

  test("doc status to the same rank prints the store error and exits 1", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const { stderr, code } = await run(["doc", "status", a.id, "spec", "draft"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("cannot move spec status");
  });

  test("invalid doc kind is rejected with the expected kinds", async () => {
    const { dir, a } = await setup();
    const { stderr, code } = await run(["doc", "read", a.id, "bogus"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("invalid kind bogus: expected spec|architecture|verification");
  });
});

describe("slice commands", () => {
  test("slice add collects criteria and slice list shows them", async () => {
    const { dir, a } = await setup();
    const added = await run(["slice", "add", a.id, "--title", "T", "--goal", "G", "c1", "c2"], {
      cwd: dir,
    });
    expect(added.code).toBe(0);
    const listed = await run(["slice", "list", a.id], { cwd: dir });
    expect(listed.code).toBe(0);
    const slices = JSON.parse(listed.stdout);
    expect(slices).toHaveLength(1);
    expect(slices[0].goal).toBe("G");
    expect(slices[0].criteria).toEqual(["c1", "c2"]);
  });

  test("slice update sets status and commit", async () => {
    const { dir, a } = await setup();
    await run(["slice", "add", a.id, "--title", "T", "--goal", "G"], { cwd: dir });
    const updated = await run(
      ["slice", "update", a.id, "1", "--status", "done", "--commit", "abc"],
      { cwd: dir },
    );
    expect(updated.code).toBe(0);
    const slice = JSON.parse(updated.stdout);
    expect(slice.status).toBe("done");
    expect(slice.commit).toBe("abc");
  });
});

describe("note commands", () => {
  test("note add and note list --target round-trip", async () => {
    const { dir, a } = await setup();
    const added = await run(
      ["note", "add", a.id, "--author", "agent", "--target", "spec", "--verdict", "ok"],
      { cwd: dir, stdin: "Looks good." },
    );
    expect(added.code).toBe(0);

    const listed = await run(["note", "list", a.id, "--target", "spec"], { cwd: dir });
    expect(listed.code).toBe(0);
    const notes = JSON.parse(listed.stdout);
    expect(notes).toHaveLength(1);
    expect(notes[0].author).toBe("agent");
    expect(notes[0].verdict).toBe("ok");
    expect(notes[0].body).toContain("Looks good.");

    const other = await run(["note", "list", a.id, "--target", "architecture"], { cwd: dir });
    expect(JSON.parse(other.stdout)).toEqual([]);
  });
});

describe("project commands", () => {
  test("project write and read round-trip via stdin", async () => {
    const { dir } = await setup();
    const written = await run(["project", "write"], { cwd: dir, stdin: "# Project\n\nGoals." });
    expect(written.code).toBe(0);
    const read = await run(["project", "read"], { cwd: dir });
    expect(read.code).toBe(0);
    expect(JSON.parse(read.stdout)).toBe("# Project\n\nGoals.\n");
  });

  test("project lesson appends under Lessons", async () => {
    const { dir } = await setup();
    const res = await run(["project", "lesson"], { cwd: dir, stdin: "Ship small slices" });
    expect(res.code).toBe(0);
    const read = await run(["project", "read"], { cwd: dir });
    const body = JSON.parse(read.stdout);
    expect(body).toContain("## Lessons");
    expect(body).toContain("- Ship small slices");
  });
});

describe("asset commands", () => {
  test("asset put copies a file into the task's assets", async () => {
    const { dir, a } = await setup();
    await Bun.write(join(dir, "shot.png"), "png-bytes");
    const res = await run(["asset", "put", a.id, "shot.png"], { cwd: dir });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toBe("assets/shot.png");
    const store = await openStore(dir);
    const task = await store.tasks.get(a.id);
    expect(await Bun.file(join(task.dir, "assets", "shot.png")).text()).toBe("png-bytes");
  });
});

describe("pipeline", () => {
  test("full pipeline drives next to done in a temp repo", async () => {
    const dir = await tmp();
    const ok = async (args: string[], stdin?: string) => {
      const res = await run(args, { cwd: dir, stdin });
      expect(res.code).toBe(0);
      return res;
    };

    await ok(["init"]);
    const created = await ok(["task", "create", "--title", "Feature"]);
    const id = JSON.parse(created.stdout).id;

    await ok(["doc", "write", id, "spec"], "# Spec\n");
    for (const status of ["critiqued", "reviewed", "approved"]) {
      await ok(["doc", "status", id, "spec", status]);
    }
    await ok(["doc", "write", id, "architecture"], "# Architecture\n");
    for (const status of ["critiqued", "reviewed", "approved"]) {
      await ok(["doc", "status", id, "architecture", status]);
    }
    await ok(["slice", "add", id, "--title", "One", "--goal", "First goal"]);
    await ok(["slice", "add", id, "--title", "Two", "--goal", "Second goal"]);
    // next requires every slice done
    await ok(["slice", "update", id, "1", "--status", "done", "--commit", "abc"]);
    await ok(["slice", "update", id, "2", "--status", "done", "--commit", "def"]);
    await ok(["note", "add", id, "--author", "agent", "--target", "spec"], "Reviewed.");
    await ok(["doc", "write", id, "verification"], "# Verification\n");
    await ok(["doc", "result", id, "pass"]);

    const res = await ok(["next", id]);
    expect(JSON.parse(res.stdout).stage).toBe("done");
  });
});

describe("print", () => {
  test("prints nothing for undefined; null prints only in JSON mode", () => {
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
    expect(calls).toEqual(json ? [["null"]] : []);
  });
});
