import { addNote, findRoot, listNotes } from "../store/index.ts";
import { defineCommand } from "citty";

const add = defineCommand({
  meta: { name: "add", description: "Add a note to a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    author: { type: "string", description: "Note author", required: true },
    target: { type: "string", description: "What the note is about (e.g. spec)", required: true },
    verdict: { type: "string", description: "Note verdict" },
  },
  run: async ({ args }) =>
    addNote(findRoot(), args.id, {
      author: args.author,
      target: args.target,
      verdict: args.verdict,
      body: await Bun.stdin.text(),
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
