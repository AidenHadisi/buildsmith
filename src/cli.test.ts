import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, findRoot, getTask, init, writeProject } from "./store/index.ts";

const main = join(import.meta.dir, "main.ts");
const dirs: string[] = [];

// Keep a real user config out of the tests; the layer under test is written per-test.
process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "buildsmith-xdg-"));

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function spawn(
  args: string[],
  opts: { cwd: string; stdin?: string; env?: Record<string, string> },
) {
  return Bun.spawn(["bun", main, ...args], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", ...opts.env },
  });
}

async function run(
  args: string[],
  opts: { cwd: string; stdin?: string; env?: Record<string, string> },
) {
  const proc = spawn(args, opts);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function ok(cwd: string, args: string[], stdin?: string) {
  const res = await run(args, { cwd, stdin });
  expect(res.code).toBe(0);
  return res;
}

async function tmp() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-cli-"));
  dirs.push(dir);
  return dir;
}

async function setup() {
  const dir = await tmp();
  const root = await init(dir);
  await writeProject(root, "## Run\n\n- bun test\n\n## Lessons\n");
  const a = await createTask(root, { title: "Task A", description: "First" });
  const b = await createTask(root, { title: "Task B", description: "Second" });
  return { dir, a, b };
}

describe("help", () => {
  test("root --help lists every command group", async () => {
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
      "board",
    ]) {
      expect(stdout).toContain(group);
    }
  });

  test("task --help lists create, list, get, update", async () => {
    const { stdout, code } = await run(["task", "--help"], { cwd: await tmp() });
    expect(code).toBe(0);
    for (const sub of ["create", "list", "get", "update"]) {
      expect(stdout).toContain(sub);
    }
    expect(stdout).not.toContain("move");
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
    expect(tasks[0].next.column).toBe("backlog");
    expect(tasks[0].next.stage).toBe("spec");
    expect(tasks[0]).not.toHaveProperty("column");
    expect(tasks[0]).not.toHaveProperty("order");
  });

  test("ambiguous short id prints one stderr line and exits 1", async () => {
    const { dir } = await setup();
    const { stdout, stderr, code } = await run(["task", "get", "task"], { cwd: dir });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    const err = stderr.trim();
    expect(err.split("\n")).toHaveLength(1);
    expect(JSON.parse(err).error).toBe("ambiguous task id task");
  });

  test("unknown short id prints one stderr line and exits 1", async () => {
    const { dir } = await setup();
    const { stderr, code } = await run(["task", "get", "nope"], { cwd: dir });
    expect(code).toBe(1);
    const err = stderr.trim();
    expect(err.split("\n")).toHaveLength(1);
    expect(JSON.parse(err).error).toBe("task nope not found");
  });

  test("init, create, update, get round-trip in a temp repo", async () => {
    const dir = await tmp();
    const init = await run(["init"], { cwd: dir });
    expect(init.code).toBe(0);
    // macOS temp dirs are symlinked (/var -> /private/var); the spawned process reports the real path
    expect(JSON.parse(init.stdout)).toBe(await realpath(join(dir, ".buildsmith")));
    await stat(join(dir, ".buildsmith", "config.yml"));
    expect(await Bun.file(join(dir, ".buildsmith", "project.md")).exists()).toBe(false);

    const created = await run(["task", "create", "--title", "X"], { cwd: dir });
    expect(created.code).toBe(0);
    const task = JSON.parse(created.stdout);
    expect(task.id).toBe("x");
    expect(task.criteria).toBeUndefined();

    const updated = await run(["task", "update", task.id, "--branch", "b"], { cwd: dir });
    expect(updated.code).toBe(0);

    const got = await run(["task", "get", "x"], { cwd: dir });
    expect(got.code).toBe(0);
    const full = JSON.parse(got.stdout);
    expect(full.branch).toBe("b");
    expect(full.criteria).toBeUndefined();

    const named = await run(["task", "create", "--id", "invoices-pdf", "--title", "Invoice PDF"], {
      cwd: dir,
    });
    expect(named.code).toBe(0);
    expect(JSON.parse(named.stdout).id).toBe("invoices-pdf");
    const dup = await run(["task", "create", "--id", "invoices-pdf", "--title", "Other"], {
      cwd: dir,
    });
    expect(dup.code).toBe(1);
    expect(dup.stderr).toContain("task invoices-pdf already exists");

    const piped = await run(["task", "create", "--title", "Piped"], {
      cwd: dir,
      stdin: "Why it matters.\n\n- a constraint\n",
    });
    expect(piped.code).toBe(0);
    expect(JSON.parse(piped.stdout).description).toBe("Why it matters.\n\n- a constraint");
  });
});

describe("doc commands", () => {
  test("doc write stores the piped body verbatim in spec.md", async () => {
    const { dir, a } = await setup();
    const content = "# Spec\n\nByte identical body.\n";
    const res = await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: content });
    expect(res.code).toBe(0);

    const spec = join((await getTask(findRoot(dir), a.id)).dir, "spec.md");
    expect(await Bun.file(spec).text()).toEndWith(content);
  });

  test("doc write without a piped body fails with empty body", async () => {
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
    const status = await run(["doc", "status", a.id, "verification", "approved"], { cwd: dir });
    expect(status.code).toBe(1);
    expect(status.stderr).toContain("invalid kind verification: expected spec|architecture");
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const badStatus = await run(["doc", "status", a.id, "spec", "nope"], { cwd: dir });
    expect(badStatus.code).toBe(1);
    expect(badStatus.stderr).toContain(
      "invalid status nope: expected draft|critiqued|reviewed|approved",
    );
    const badResult = await run(["doc", "result", a.id, "nope"], { cwd: dir });
    expect(badResult.code).toBe(1);
    expect(badResult.stderr).toContain("invalid result nope: expected pass|fail");
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
    expect(JSON.parse(res.stdout)).toBe("![shot.png](assets/shot.png)");
    const task = await getTask(findRoot(dir), a.id);
    expect(await Bun.file(join(task.dir, "assets", "shot.png")).text()).toBe("png-bytes");
  });
});

describe("pipeline", () => {
  test("full pipeline drives next to done in a temp repo", async () => {
    const dir = await tmp();
    await ok(dir, ["init"]);
    await ok(dir, ["project", "write"], "## Run\n\n- bun test\n");
    const created = await ok(dir, ["task", "create", "--title", "Feature"]);
    const id = JSON.parse(created.stdout).id;

    await ok(dir, ["doc", "write", id, "spec"], "# Spec\n");
    await ok(
      dir,
      ["doc", "write", id, "architecture"],
      "# Architecture\n\n## Slices\n\n### One\n\nFirst goal\n\n**Criteria:**\n\n- one works\n\n### Two\n\nSecond goal\n\n**Criteria:**\n\n- two works\n",
    );
    for (const kind of ["spec", "architecture"]) {
      for (const status of ["critiqued", "reviewed", "approved"]) {
        await ok(dir, ["doc", "status", id, kind, status]);
      }
    }
    // next requires every slice done
    await ok(dir, ["slice", "update", id, "1", "--status", "done", "--commit", "abc"]);
    await ok(dir, ["slice", "update", id, "2", "--status", "done", "--commit", "def"]);
    await ok(
      dir,
      ["note", "add", id, "--author", "polisher", "--target", "polish", "--verdict", "done"],
      "None.",
    );
    await ok(
      dir,
      ["note", "add", id, "--author", "code-reviewer", "--target", "branch", "--verdict", "pass"],
      "Findings: None.",
    );
    await ok(dir, ["note", "add", id, "--author", "agent", "--target", "spec"], "Reviewed.");
    await ok(dir, ["doc", "write", id, "verification"], "# Verification\n");
    await ok(dir, ["doc", "result", id, "pass"]);

    const res = await ok(dir, ["next", id]);
    expect(JSON.parse(res.stdout).stage).toBe("done");

    const brief = await ok(dir, ["brief", id]);
    expect(JSON.parse(brief.stdout)).toEqual({ action: "none" });

    const step = await ok(dir, ["step", id]);
    expect(JSON.parse(step.stdout)).toEqual({ do: "done", action: "none" });
  });
});

describe("step command", () => {
  const step = async (dir: string, id: string) => {
    const res = await run(["step", id], { cwd: dir });
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

  test("missing project.md dispatches write-project", async () => {
    const dir = await tmp();
    await run(["init"], { cwd: dir });
    const created = await run(["task", "create", "--title", "X", "c1"], { cwd: dir });
    const task = JSON.parse(created.stdout);
    const res = await step(dir, task.id);
    expect(res.do).toBe("dispatch");
    expect(res.action).toBe("write-project");
    expect(res.readonly).toBe(false);
    expect(res.model).toBe("inherit");
    expect(res.prompt).toContain(`brief ${task.id}`);
  });

  test("after a spec write dispatches review-spec read-only with the configured model", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const res = await step(dir, a.id);
    expect(res.do).toBe("dispatch");
    expect(res.action).toBe("review-spec");
    expect(res.readonly).toBe(true);
    expect(res.model).toBe("inherit");
    expect(res.prompt).toContain(`brief ${a.id}`);

    const userDir = join(process.env.XDG_CONFIG_HOME!, "buildsmith");
    dirs.push(userDir);
    await Bun.write(join(userDir, "config.yml"), "models:\n  strong: user-strong\n");
    expect((await step(dir, a.id)).model).toBe("user-strong");

    const config = join(dir, ".buildsmith", "config.yml");
    await Bun.write(config, "models:\n  strong: repo-strong\n");
    const brief = await run(["brief", a.id], { cwd: dir });
    expect(JSON.parse(brief.stdout).model).toBe("repo-strong");

    await Bun.write(config, "models: [bad]\n");
    const { code, stderr } = await run(["step", a.id], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain(
      `invalid ${join(await realpath(dir), ".buildsmith", "config.yml")} (models)`,
    );
  });

  test("an unchanged board nudges once, then asks, then clears after a change", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    expect((await step(dir, a.id)).prompt).toStartWith("Run ");
    expect((await step(dir, a.id)).prompt).toStartWith("The board did not change");
    const stalled = await step(dir, a.id);
    expect(stalled.do).toBe("ask");
    expect(stalled.text).toContain("review-spec");

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
    const nextRes = await run(["next", a.id], { cwd: dir });
    expect(nextRes.code).toBe(0);
    expect(JSON.parse(nextRes.stdout).ask).toContain("revision 5");
  });
});

describe("brief command", () => {
  test("brief at write-spec prints the task title and the cli command", async () => {
    const { dir, a } = await setup();
    const { stdout, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("write-spec");
    expect(brief.text).toContain("Title: Task A");
    expect(brief.text).toContain("ID: `");
    expect(brief.text).toContain("Branch:");
    expect(brief.text).toContain("Revision:");
    expect(brief.text).toContain("Reason:");
    expect(brief.text).toContain("First");
    expect(brief.text).toContain("bun ");
    expect(brief.text).not.toContain("{{");
  });

  test("brief at write-project tells the researcher to record with project write", async () => {
    const dir = await tmp();
    await run(["init"], { cwd: dir });
    const created = await run(["task", "create", "--title", "X", "c1"], { cwd: dir });
    const task = JSON.parse(created.stdout);
    const { stdout, code } = await run(["brief", task.id], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("write-project");
    expect(brief.run).toBe("dispatch");
    expect(brief.readonly).toBe(false);
    expect(brief.text).toContain("project write");
    expect(brief.text).toContain("## Deploy");
    expect(brief.text).toContain("## Commits");
    expect(brief.text).not.toContain("{{");
  });

  test("brief after a spec write returns review-spec with model and readonly", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n\nThe spec body.\n" });
    const { stdout, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("review-spec");
    expect(brief.run).toBe("dispatch");
    expect(brief.model).toBe("inherit");
    expect(brief.readonly).toBe(true);
    expect(brief.text).toContain("The spec body.");
    expect(brief.text).toContain("Two implementers would build the same thing");
    expect(brief.text).toContain("Does this need to exist?");
  });

  test("explicit action renders that template with reason (requested)", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const { stdout, code } = await run(["brief", a.id, "write-spec"], { cwd: dir });
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
      join(dir, ".buildsmith", "prompts", "review-spec.md"),
      "---\nrun: dispatch\nmodel: fast\nreadonly: true\n---\nCUSTOM {{title}}\n",
    );
    const { stdout, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(0);
    const brief = JSON.parse(stdout);
    expect(brief.model).toBe("inherit");
    expect(brief.text.trim()).toBe("CUSTOM Task A");
  });

  test("an override with an unknown slot exits 1", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    await Bun.write(
      join(dir, ".buildsmith", "prompts", "review-spec.md"),
      "---\nrun: dispatch\nmodel: fast\nreadonly: true\n---\n{{bogus}}\n",
    );
    const { stderr, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("unknown slot {{bogus}}");
  });

  test("brief at work-slice renders the architecture, the slice, and only its notes", async () => {
    const dir = await tmp();
    await ok(dir, ["init"]);
    await ok(dir, ["project", "write"], "## Run\n\n- bun test\n");
    const created = await ok(dir, ["task", "create", "--title", "Feature"]);
    const id = JSON.parse(created.stdout).id;
    await ok(dir, ["doc", "write", id, "spec"], "# Spec\n");
    await ok(
      dir,
      ["doc", "write", id, "architecture"],
      "# Architecture\n\nThe arch body.\n\n## Slices\n\n### One\n\nFirst goal\n\n**Criteria:**\n\n- it works\n",
    );
    for (const kind of ["spec", "architecture"]) {
      for (const status of ["critiqued", "reviewed", "approved"]) {
        await ok(dir, ["doc", "status", id, kind, status]);
      }
    }
    await ok(dir, ["slice", "update", id, "1", "--status", "review", "--commit", "abc123"]);
    await ok(dir, ["note", "add", id, "--author", "coder", "--target", "slice-1"], "Slice note.");
    await ok(dir, ["note", "add", id, "--author", "critic", "--target", "spec"], "Spec note.");

    const { stdout } = await ok(dir, ["brief", id]);
    const brief = JSON.parse(stdout);
    expect(brief.action).toBe("work-slice");
    expect(brief.text).toContain("The arch body.");
    expect(brief.text).toContain("#1 ");
    expect(brief.text).toContain("commit: abc123");
    expect(brief.text).toContain("Slice note.");
    expect(brief.text).not.toContain("Spec note.");
    expect(brief.text).toContain("The ladder");
  });

  test(".extra.md fills {{extra}} without ejecting", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    await Bun.write(join(dir, ".buildsmith", "prompts", "review-spec.extra.md"), "EXTRA RULE\n");
    const { stdout, code } = await run(["brief", a.id], { cwd: dir });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).text).toContain("EXTRA RULE");
  });
});

describe("prompt commands", () => {
  async function sources(dir: string) {
    const { stdout } = await ok(dir, ["prompt", "list"]);
    const entries = JSON.parse(stdout) as { action: string; source: string }[];
    return Object.fromEntries(entries.map((e) => [e.action, e.source]));
  }

  test("prompt list is all built-in, then repo after eject", async () => {
    const { dir } = await setup();
    const before = await sources(dir);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    expect(Object.values(before).every((source) => source === "built-in")).toBe(true);
    expect(before["standards/design"]).toBe("built-in");
    expect(before["standards/spec"]).toBe("built-in");
    expect(before["include/task"]).toBe("built-in");

    const ejected = await ok(dir, ["prompt", "eject", "review-spec"]);
    expect(JSON.parse(ejected.stdout).path).toBe(
      join(await realpath(dir), ".buildsmith", "prompts", "review-spec.md"),
    );

    const after = await sources(dir);
    expect(after["review-spec"]).toBe("repo");
    expect(after["write-spec"]).toBe("built-in");
  });

  test("eject twice errors", async () => {
    const { dir } = await setup();
    await run(["prompt", "eject", "review-spec"], { cwd: dir });
    const { stderr, code } = await run(["prompt", "eject", "review-spec"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("already ejected");
  });

  test("show prints the resolved raw text including frontmatter", async () => {
    const { dir } = await setup();
    const { stdout, code } = await run(["prompt", "show", "review-spec"], { cwd: dir });
    expect(code).toBe(0);
    const shown = JSON.parse(stdout);
    expect(shown.text).toStartWith("---\nrun: dispatch");
    expect(shown.text).toContain("{{extra}}");
  });

  test("diff without an override prints no override", async () => {
    const { dir } = await setup();
    const { stdout, code } = await run(["prompt", "diff", "review-spec"], { cwd: dir });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toBe("no override for review-spec");
  });

  test("diff after an edit shows the changed lines", async () => {
    const { dir } = await setup();
    await run(["prompt", "eject", "review-spec"], { cwd: dir });
    const path = join(dir, ".buildsmith", "prompts", "review-spec.md");
    const text = await Bun.file(path).text();
    await Bun.write(path, text.replace("{{extra}}", "{{extra}}\nEDITED LINE"));
    const { stdout, code } = await run(["prompt", "diff", "review-spec"], { cwd: dir });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toContain("+EDITED LINE");
    expect(JSON.parse(stdout)).toMatch(/^-/m);
  });

  test("an ejected standard overrides briefs and diffs against the built-in", async () => {
    const { dir, a } = await setup();
    await run(["doc", "write", a.id, "spec"], { cwd: dir, stdin: "# Spec\n" });
    const ejected = await run(["prompt", "eject", "standards/spec"], { cwd: dir });
    expect(ejected.code).toBe(0);
    expect(JSON.parse(ejected.stdout).path).toBe(
      join(await realpath(dir), ".buildsmith", "prompts", "standards", "spec.md"),
    );

    const path = join(dir, ".buildsmith", "prompts", "standards", "spec.md");
    await Bun.write(path, `${await Bun.file(path).text()}\nCUSTOM STANDARD\n`);

    const brief = await run(["brief", a.id], { cwd: dir });
    expect(brief.code).toBe(0);
    expect(JSON.parse(brief.stdout).text).toContain("CUSTOM STANDARD");

    const diff = await run(["prompt", "diff", "standards/spec"], { cwd: dir });
    expect(diff.code).toBe(0);
    expect(JSON.parse(diff.stdout)).toContain("+CUSTOM STANDARD");
  });

  test("an ejected task card overrides briefs and diffs against the built-in", async () => {
    const { dir, a } = await setup();
    const ejected = await run(["prompt", "eject", "include/task"], { cwd: dir });
    expect(ejected.code).toBe(0);
    expect(JSON.parse(ejected.stdout).path).toBe(
      join(await realpath(dir), ".buildsmith", "prompts", "include", "task.md"),
    );

    const path = join(dir, ".buildsmith", "prompts", "include", "task.md");
    await Bun.write(path, "CUSTOM CARD {{title}}\n");

    const brief = await run(["brief", a.id], { cwd: dir });
    expect(brief.code).toBe(0);
    expect(JSON.parse(brief.stdout).text).toContain("CUSTOM CARD Task A");

    const diff = await run(["prompt", "diff", "include/task"], { cwd: dir });
    expect(diff.code).toBe(0);
    expect(JSON.parse(diff.stdout)).toContain("+CUSTOM CARD");
  });
});

describe("board command", () => {
  async function dist() {
    const dir = await tmp();
    await Bun.write(join(dir, "index.html"), "<!doctype html><title>stub</title>");
    return dir;
  }

  async function tasks(url: string) {
    const board = (await (await fetch(`${url}/api/board`)).json()) as { tasks: unknown[] };
    return board.tasks;
  }

  // Starts the server and resolves once it has printed its URL; the caller stops it.
  async function serve(args: string[], cwd: string, env: Record<string, string>) {
    const proc = spawn(["board", "--no-open", ...args], { cwd, env });
    try {
      const { value } = await proc.stdout.getReader().read();
      const url = new TextDecoder().decode(value).match(/^Board: (\S+)$/m)?.[1];
      if (!url) throw new Error("board did not print its URL");
      return { proc, url };
    } catch (err) {
      proc.kill();
      throw err;
    }
  }

  test("serves the board and exits 0 on SIGINT", async () => {
    const { dir } = await setup();
    const { proc, url } = await serve(["--port", "0"], dir, { BUILDSMITH_DIST: await dist() });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await tasks(url)).toHaveLength(2);
    expect(await (await fetch(`${url}/`)).text()).toContain("stub");
    proc.kill("SIGINT");
    expect(await proc.exited).toBe(0);
  });

  test("missing dist exits 1 and names bun run build", async () => {
    const { dir } = await setup();
    const { stderr, code } = await run(["board", "--no-open"], {
      cwd: dir,
      env: { BUILDSMITH_DIST: await tmp() },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("bun run build");
  });

  test("no .buildsmith exits 1 and names buildsmith init", async () => {
    const { stderr, code } = await run(["board", "--no-open"], { cwd: await tmp() });
    expect(code).toBe(1);
    expect(stderr).toContain("buildsmith init");
  });

  test("a taken port falls back to a free one", async () => {
    const { dir } = await setup();
    const held = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      const { proc, url } = await serve(["--port", String(held.port)], dir, {
        BUILDSMITH_DIST: await dist(),
      });
      expect(url).not.toBe(held.url.origin);
      expect(await tasks(url)).toHaveLength(2);
      proc.kill("SIGINT");
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(code).toBe(0);
      expect(stderr).toContain(`port ${held.port} in use`);
    } finally {
      held.stop(true);
    }
  });
});
