import { addLesson, findRoot, readProject, writeProject } from "../store/index.ts";
import { defineCommand } from "citty";

const read = defineCommand({
  meta: { name: "read", description: "Read the project document" },
  run: () => readProject(findRoot()),
});

const write = defineCommand({
  meta: { name: "write", description: "Overwrite the project document" },
  args: {
    file: { type: "string", description: "Read the body from a file instead of stdin" },
  },
  run: async ({ args }) => writeProject(findRoot(), await body(args.file)),
});

const lesson = defineCommand({
  meta: { name: "lesson", description: "Append a lesson to the project document" },
  args: {
    file: { type: "string", description: "Read the lesson from a file instead of stdin" },
  },
  run: async ({ args }) => addLesson(findRoot(), await body(args.file)),
});

export default defineCommand({
  meta: { name: "project", description: "Read and write the project document" },
  subCommands: { read, write, lesson },
});

async function body(file?: string) {
  const text = file
    ? await Bun.file(file).text()
    : process.stdin.isTTY
      ? ""
      : await Bun.stdin.text();
  if (!text) throw new Error("empty body: provide --file or pipe a body on stdin");
  return text;
}
