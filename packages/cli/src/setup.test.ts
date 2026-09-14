import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const main = join(import.meta.dir, "main.ts");
const plugin = join(import.meta.dir, "../plugin");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(args: string[], home: string) {
  const proc = Bun.spawn([process.execPath, main, ...args], {
    cwd: home,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin", NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function tmp() {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-setup-"));
  dirs.push(dir);
  return dir;
}

describe("setup", () => {
  test("setup --dry-run JSON lists all three hosts with dry-run", async () => {
    const { stdout, code } = await run(["setup", "--dry-run"], await tmp());
    expect(code).toBe(0);
    const steps = JSON.parse(stdout) as { host: string; status: string }[];
    expect(new Set(steps.map((s) => s.host))).toEqual(new Set(["cursor", "claude", "codex"]));
    expect(steps.every((s) => s.status === "dry-run")).toBe(true);
  });

  test("setup cursor creates a symlink whose readlink resolves to the plugin dir and is idempotent", async () => {
    const home = await tmp();
    const link = join(home, ".cursor/plugins/local/buildsmith");
    for (let i = 0; i < 2; i++) {
      const { code } = await run(["setup", "cursor"], home);
      expect(code).toBe(0);
    }
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(await readlink(link))).toBe(await realpath(plugin));
  });

  test("a pre-existing real directory at the link path exits 1 with the error", async () => {
    const home = await tmp();
    const link = join(home, ".cursor/plugins/local/buildsmith");
    await mkdir(link, { recursive: true });
    const { stderr, code } = await run(["setup", "cursor"], home);
    expect(code).toBe(1);
    expect(stderr).toContain(`${link} exists and is not a symlink`);
  });

  test("setup claude statuses printed, exit 0", async () => {
    const { stdout, code } = await run(["setup", "claude"], await tmp());
    expect(code).toBe(0);
    const steps = JSON.parse(stdout) as { host: string; status: string }[];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.host === "claude" && s.status === "printed")).toBe(true);
  });

  test("setup codex printed for commands and the TOML copied if source exists", async () => {
    const home = await tmp();
    const { stdout, code } = await run(["setup", "codex"], home);
    expect(code).toBe(0);
    const steps = JSON.parse(stdout) as { host: string; action: string; status: string }[];
    expect(
      steps.filter((s) => s.action.startsWith("run:")).every((s) => s.status === "printed"),
    ).toBe(true);
    const src = join(plugin, "codex/buildsmith-worker.toml");
    if (await Bun.file(src).exists()) {
      const dest = join(home, ".codex/agents/buildsmith-worker.toml");
      expect(await Bun.file(dest).text()).toBe(await Bun.file(src).text());
    }
  });

  test("setup bogus exits 1", async () => {
    const { code } = await run(["setup", "bogus"], await tmp());
    expect(code).toBe(1);
  });
});
