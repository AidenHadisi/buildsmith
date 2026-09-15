import { addNote, findRoot, listNotes } from "../store/index.ts";
import { defineCommand } from "citty";

const add = defineCommand({
  meta: { name: "add", description: "Add a note to a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    author: { type: "string", description: "Note author", required: true },
    target: { type: "string", description: "What the note is about (e.g. spec)", required: true },
    verdict: { type: "string", description: "Note verdict" },
    file: { type: "string", description: "Read the body from a file instead of stdin" },
  },
  run: async ({ args }) =>
    addNote(findRoot(), args.id, {
      author: args.author,
      target: args.target,
      verdict: args.verdict,
      body: await body(args.file),
    }),
});

const list = defineCommand({
  meta: { name: "list", description: "List a task's notes" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    target: { type: "string", description: "Only notes with this target" },
  },
  run: ({ args }) => listNotes(findRoot(), args.id, args.target),
});

export default defineCommand({
  meta: { name: "note", description: "Add and list task notes" },
  subCommands: { add, list },
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
