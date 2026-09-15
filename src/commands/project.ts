import { addLesson, findRoot, readProject, writeProject } from "../store/index.ts";
import { defineCommand } from "citty";
import { body } from "./stdin.ts";

const read = defineCommand({
  meta: { name: "read", description: "Read the project document" },
  run: () => readProject(findRoot()),
});

const write = defineCommand({
  meta: { name: "write", description: "Overwrite the project document" },
  args: {},
  run: async ({ args }) => writeProject(findRoot(), await body()),
});

const lesson = defineCommand({
  meta: { name: "lesson", description: "Append a lesson to the project document" },
  args: {},
  run: async ({ args }) => addLesson(findRoot(), await body()),
});

export default defineCommand({
  meta: { name: "project", description: "Read and write the project document" },
  subCommands: { read, write, lesson },
});
