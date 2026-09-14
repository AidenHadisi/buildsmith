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
  test("root --help lists every command group and --json", async () => {
    const { stdout, code } = await run(["--help"], { cwd: await tmp() });
    expect(code).toBe(0);
    expect(stdout).toContain("USAGE");
    for (const group of [
      "init",
      "next",
      "step",
      "brief",
      "task",
      "doc",
      "slice",
      "note",
      "project",
      "asset",
      "prompt",
    ]) {
      expect(stdout).toContain(group);
    }
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

    const brief = await ok(["brief", id]);
    expect(brief.stdout.trim()).toBe("nothing to do");
    const briefJson = await ok(["brief", id, "--json"]);
    expect(JSON.parse(briefJson.stdout)).toEqual({ action: "none" });

    const step = await ok(["step", id, "--json"]);
    expect(JSON.parse(step.stdout)).toEqual({ do: "done", action: "none" });
  });
});

describe("step command", () => {
  const step = async (dir: string, id: string) => {
    const res = await run(["step", id, "--json"], { cwd: dir });
    expect(res.code).toBe(0);
    return JSON.parse(res.stdout);
  };

  test("fresh task is a self step at write-spec with the rendered brief", async () => {
    const { dir, a } = await setup();
    const res = await step(dir, a.id);
    expect(res.do).toBe("self");
    expect(res.action).toBe("write-spec");
    expect(res.text).toContain("Task A");
  });

  test("after a spec write dispatches critique-spec to the reader with the configured model", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const res = await step(dir, a.id);
    expect(res.do).toBe("dispatch");
    expect(res.action).toBe("critique-spec");
    expect(res.agent).toBe("buildsmith-reader");
    expect(res.model).toBe("strong");
    expect(res.prompt).toContain(`brief ${a.id}`);

    const config = join(dir, ".buildsmith", "config.yml");
    const text = await Bun.file(config).text();
    await Bun.write(config, `${text}models:\n  strong: my-strong-model\n`);
    expect((await step(dir, a.id)).model).toBe("my-strong-model");
  });

  test("an unchanged board nudges once, then asks, then clears after a change", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    expect((await step(dir, a.id)).prompt).toStartWith("Run ");
    expect((await step(dir, a.id)).prompt).toStartWith("The board did not change");
    const stalled = await step(dir, a.id);
    expect(stalled.do).toBe("ask");
    expect(stalled.text).toContain("critique-spec");

    await run(["note", "add", a.id, "--author", "critic", "--target", "spec"], {
      cwd: dir,
      stdin: "Looked.",
    });
    const fresh = await step(dir, a.id);
    expect(fresh.do).toBe("dispatch");
    expect(fresh.prompt).toStartWith("Run ");
  });

  test("a spec at revision 5 asks instead of running", async () => {
    const { dir, a } = await setup();
    for (let i = 0; i < 5; i++) {
      await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: `# Spec ${i}\n` });
    }
    const res = await step(dir, a.id);
    expect(res.do).toBe("ask");
    expect(res.text).toContain("revision 5");
  });
});

describe("brief command", () => {
  test("brief at write-spec prints the task title and the cli command", async () => {
    const { dir, a } = await setup();
    const { stdout, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toContain("Task A");
    expect(stdout).toContain("bun ");
    expect(stdout).not.toContain("{{");
  });

  test("brief --json after a spec write returns critique-spec with role and readonly", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n\nThe spec body.\n" });
    const { stdout, code } = await run(["brief", a.id, "--json"], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("critique-spec");
    expect(brief.role).toBe("critic");
    expect(brief.model).toBe("strong");
    expect(brief.readonly).toBe(true);
    expect(brief.text).toContain("The spec body.");
  });

  test("explicit action renders that template with reason (requested)", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const { stdout, code } = await run(["brief", a.id, "write-spec", "--json"], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("write-spec");
    expect(brief.text).toContain("(requested)");
  });

  test("unknown action exits 1", async () => {
    const { dir, a } = await setup();
    const { stderr, code } = await run(["brief", a.id, "bogus"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("unknown action bogus");
  });

  test("a repo override replaces the built-in template", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    await Bun.write(
      join(dir, ".buildsmith", "prompts", "critique-spec.md"),
      "---\nrole: critic\nmodel: fast\nreadonly: true\n---\nCUSTOM {{title}}\n",
    );
    const { stdout, code } = await run(["brief", a.id, "--json"], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.model).toBe("fast");
    expect(brief.text.trim()).toBe("CUSTOM Task A");
  });

  test("an override with an unknown slot exits 1", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    await Bun.write(
      join(dir, ".buildsmith", "prompts", "critique-spec.md"),
      "---\nrole: critic\nmodel: fast\nreadonly: true\n---\n{{bogus}}\n",
    );
    const { stderr, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("unknown slot {{bogus}}");
  });

  test("brief at review-slice renders the architecture, the slice, and only its notes", async () => {
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
    await ok(["doc", "write", id, "architecture"], "# Architecture\n\nThe arch body.\n");
    for (const kind of ["spec", "architecture"]) {
      for (const status of ["critiqued", "reviewed", "approved"]) {
        await ok(["doc", "status", id, kind, status]);
      }
    }
    await ok(["slice", "add", id, "--title", "One", "--goal", "First goal"]);
    await ok(["slice", "update", id, "1", "--status", "review", "--commit", "abc123"]);
    await ok(["note", "add", id, "--author", "coder", "--target", "slice-1"], "Slice note.");
    await ok(["note", "add", id, "--author", "critic", "--target", "spec"], "Spec note.");

    const { stdout } = await ok(["brief", id, "--json"]);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("review-slice");
    expect(brief.text).toContain("The arch body.");
    expect(brief.text).toContain("#1 ");
    expect(brief.text).toContain("commit: abc123");
    expect(brief.text).toContain("Slice note.");
    expect(brief.text).not.toContain("Spec note.");
  });

  test(".extra.md fills {{extra}} without ejecting", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    await Bun.write(join(dir, ".buildsmith", "prompts", "critique-spec.extra.md"), "EXTRA RULE\n");
    const { stdout, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toContain("EXTRA RULE");
  });
});

describe("prompt commands", () => {
  test("prompt list is all built-in, then repo after eject", async () => {
    const { dir } = await setup();
    const before = await run(["prompt", "list"], { cwd: dir });
    expect(before.code).toBe(0);
    const entries = JSON.parse(before.stdout) as { action: string; source: string }[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.source === "built-in")).toBe(true);

    const ejected = await run(["prompt", "eject", "critique-spec"], { cwd: dir });
    expect(ejected.code).toBe(0);
    expect(JSON.parse(ejected.stdout).path).toBe(
      join(await realpath(dir), ".buildsmith", "prompts", "critique-spec.md"),
    );

    const after = await run(["prompt", "list"], { cwd: dir });
    const sources = Object.fromEntries(
      (JSON.parse(after.stdout) as { action: string; source: string }[]).map((e) => [
        e.action,
        e.source,
      ]),
    );
    expect(sources["critique-spec"]).toBe("repo");
    expect(sources["write-spec"]).toBe("built-in");
  });

  test("eject twice errors", async () => {
    const { dir } = await setup();
    await run(["prompt", "eject", "critique-spec"], { cwd: dir });
    const { stderr, code } = await run(["prompt", "eject", "critique-spec"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("already ejected");
  });

  test("show prints the resolved raw text including frontmatter", async () => {
    const { dir } = await setup();
    const { stdout, code } = await run(["prompt", "show", "critique-spec"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toStartWith("---\nrole: critic");
    expect(stdout).toContain("{{extra}}");
  });

  test("diff without an override prints no override", async () => {
    const { dir } = await setup();
    const { stdout, code } = await run(["prompt", "diff", "critique-spec"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("no override for critique-spec");
  });

  test("diff after an edit shows the changed lines", async () => {
    const { dir } = await setup();
    await run(["prompt", "eject", "critique-spec"], { cwd: dir });
    const path = join(dir, ".buildsmith", "prompts", "critique-spec.md");
    const text = await Bun.file(path).text();
    await Bun.write(path, text.replace("{{extra}}", "{{extra}}\nEDITED LINE"));
    const { stdout, code } = await run(["prompt", "diff", "critique-spec"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toContain("+EDITED LINE");
    expect(stdout).toMatch(/^-/m);
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
