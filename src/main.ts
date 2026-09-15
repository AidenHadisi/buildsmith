#!/usr/bin/env bun
import { defineCommand, renderUsage, runMain } from "citty";
import { version } from "../package.json" with { type: "json" };
import asset from "./commands/asset.ts";
import board from "./commands/board.ts";
import brief from "./commands/brief.ts";
import doc from "./commands/doc.ts";
import init from "./commands/init.ts";
import next from "./commands/next.ts";
import note from "./commands/note.ts";
import project from "./commands/project.ts";
import prompt from "./commands/prompt.ts";
import setup from "./commands/setup.ts";
import slice from "./commands/slice.ts";
import step from "./commands/step.ts";
import task from "./commands/task.ts";

const help = process.argv.some((arg) => arg === "--help" || arg === "-h");

const main = defineCommand({
  meta: {
    name: "buildsmith",
    version,
    description: "Manage the Buildsmith board from the shell",
  },
  subCommands: {
    init,
    next,
    step,
    brief,
    task,
    doc,
    slice,
    note,
    project,
    asset,
    prompt,
    setup,
    board,
  },
});

function output(cmd: { run?: (ctx: never) => unknown; subCommands?: unknown }) {
  const run = cmd.run;
  if (run) {
    cmd.run = async (ctx) => {
      try {
        const value = await run(ctx);
        if (value === undefined) return;
        console.log(JSON.stringify(value, null, 2));
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        console.error(JSON.stringify({ error: err.message }));
        process.exitCode = 1;
      }
    };
  }
  if (cmd.subCommands && typeof cmd.subCommands === "object") {
    for (const sub of Object.values(cmd.subCommands)) output(sub);
  }
}

output(main);

runMain(main, {
  showUsage: async (cmd, parent) =>
    (help ? console.log : console.error)(await renderUsage(cmd, parent)),
});
