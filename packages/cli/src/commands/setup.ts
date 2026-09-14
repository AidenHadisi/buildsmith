import { copyFile, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { asEnum, guard } from "../io.ts";

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
  run: guard((args) => setup(args._.length ? args._ : [...HOSTS], Boolean(args.dryRun))),
});

async function run(cmd: string[]): Promise<Status> {
  const proc = Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] });
  const code = await proc.exited;
  if (code) throw new Error(`${cmd.join(" ")} exited ${code}`);
  return "done";
}

async function setup(names: string[], dry: boolean): Promise<Step[]> {
  const home = homedir();
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
      const bin = Bun.which(host);
      for (const cmd of cmds) {
        steps.push({
          host,
          action: `run: ${cmd.join(" ")}`,
          status: dry ? "dry-run" : bin ? await run(cmd) : "printed",
        });
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
