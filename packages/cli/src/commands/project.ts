import { defineCommand } from "citty";
import { act, body } from "../io.ts";

const read = defineCommand({
  meta: { name: "read", description: "Read the project document" },
  run: act((store) => store.project.read()),
});

const write = defineCommand({
  meta: { name: "write", description: "Overwrite the project document" },
  args: {
    file: { type: "string", description: "Read the body from a file instead of stdin" },
  },
  run: act(async (store, args) => store.project.write(await body(args.file))),
});

const lesson = defineCommand({
  meta: { name: "lesson", description: "Append a lesson to the project document" },
  args: {
    file: { type: "string", description: "Read the lesson from a file instead of stdin" },
  },
  run: act(async (store, args) => store.project.addLesson(await body(args.file))),
});

export default defineCommand({
  meta: { name: "project", description: "Read and write the project document" },
  subCommands: { read, write, lesson },
});
