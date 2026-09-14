import { copyFile, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { asEnum, json, print } from "../io.ts";

const HOSTS = ["cursor", "claude", "codex"] as const;
const PLUGIN = join(import.meta.dir, "../../plugin");
type Host = (typeof HOSTS)[number];
type Status = "done" | "printed" | "dry-run";
type Step = { host: Host; action: string; status: Status };

export default defineCommand({
  meta: { name: "setup", description: "Install the Buildsmith plugin for agent hosts" },
  args: {
    hosts: {
      type: "positional",
      description: "cursor, claude, codex (default: all)",
      required: false,
    },
    dryRun: { type: "boolean", description: "Print actions without changing anything" },
  },
  async run({ args }) {
    try {
      print(await setup(args._.length ? args._ : [...HOSTS], Boolean(args.dryRun)));
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      console.error(json ? JSON.stringify({ error: err.message }) : err.message);
      process.exitCode = 1;
    }
  },
});

async function exec(cmd: string[], dry: boolean): Promise<Status> {
  if (dry) return "dry-run";
  if (!Bun.which(cmd[0]!)) return "printed";
  const proc = Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] });
  if (await proc.exited) throw new Error(cmd.join(" "));
  return "done";
}

async function setup(names: string[], dry: boolean): Promise<Step[]> {
  const home = homedir() || process.env.HOME!;
  const steps: Step[] = [];
  for (const host of names.map((n) => asEnum("host", n, HOSTS))) {
    if (host === "cursor") {
      const link = join(home, ".cursor/plugins/local/buildsmith");
      if (!dry) {
        const st = await lstat(link).catch(() => undefined);
        if (st?.isSymbolicLink()) await rm(link);
        else if (st) throw new Error(`${link} exists and is not a symlink`);
        else await mkdir(dirname(link), { recursive: true });
        await symlink(PLUGIN, link);
      }
      steps.push({
        host,
        action: `symlink ${PLUGIN} -> ${link}`,
        status: dry ? "dry-run" : "done",
      });
    } else {
      const verb = host === "claude" ? "install" : "add";
      const cmds = [
        [host, "plugin", "marketplace", "add", "AidenHadisi/buildsmith"],
        [host, "plugin", verb, "buildsmith@buildsmith"],
      ];
      for (const cmd of cmds) {
        steps.push({ host, action: `run: ${cmd.join(" ")}`, status: await exec(cmd, dry) });
      }
      if (host !== "codex") continue;
      const src = join(PLUGIN, "codex/buildsmith-worker.toml");
      const dest = join(home, ".codex/agents/buildsmith-worker.toml");
      if (!dry) {
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(src, dest);
      }
      steps.push({ host, action: `copy ${src} -> ${dest}`, status: dry ? "dry-run" : "done" });
    }
  }
  return steps;
}
