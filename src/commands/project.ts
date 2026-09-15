import { addLesson, findRoot, readProject, writeProject } from "../store/index.ts";
import { defineCommand } from "citty";

const read = defineCommand({
  meta: { name: "read", description: "Read the project document" },
  run: () => readProject(findRoot()),
});

const write = defineCommand({
  meta: { name: "write", description: "Overwrite the project document" },
  run: async () => writeProject(findRoot(), await Bun.stdin.text()),
});

const lesson = defineCommand({
  meta: { name: "lesson", description: "Append a lesson to the project document" },
  run: async () => addLesson(findRoot(), await Bun.stdin.text()),
});

export default defineCommand({
  meta: { name: "project", description: "Read and write the project document" },
  subCommands: { read, write, lesson },
});
