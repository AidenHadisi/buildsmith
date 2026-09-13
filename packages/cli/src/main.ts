#!/usr/bin/env bun
import { defineCommand, renderUsage, runMain } from "citty";
import { version } from "../package.json" with { type: "json" };
import asset from "./commands/asset.ts";
import doc from "./commands/doc.ts";
import init from "./commands/init.ts";
import next from "./commands/next.ts";
import note from "./commands/note.ts";
import project from "./commands/project.ts";
import slice from "./commands/slice.ts";
import task from "./commands/task.ts";
import { help } from "./io.ts";

const main = defineCommand({
  meta: {
    name: "buildsmith",
    version,
    description: "Manage the Buildsmith board from the shell",
  },
  args: {
    json: { type: "boolean", description: "JSON output (default when stdout is not a TTY)" },
  },
  subCommands: { init, next, task, doc, slice, note, project, asset },
});

runMain(main, {
  showUsage: async (cmd, parent) =>
    (help ? console.log : console.error)(await renderUsage(cmd, parent)),
});
