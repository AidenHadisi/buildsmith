import { defineCommand } from "citty";
import { act, body } from "../io.ts";

const add = defineCommand({
  meta: { name: "add", description: "Add a note to a task" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    author: { type: "string", description: "Note author", required: true },
    target: { type: "string", description: "What the note is about (e.g. spec)", required: true },
    verdict: { type: "string", description: "Note verdict" },
    file: { type: "string", description: "Read the body from a file instead of stdin" },
  },
  run: act(async (store, args) =>
    store.addNote(args.id, {
      author: args.author,
      target: args.target,
      verdict: args.verdict,
      body: await body(args.file),
    }),
  ),
});

const list = defineCommand({
  meta: { name: "list", description: "List a task's notes" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    target: { type: "string", description: "Only notes with this target" },
  },
  run: act((store, args) => store.listNotes(args.id, args.target)),
});

export default defineCommand({
  meta: { name: "note", description: "Add and list task notes" },
  subCommands: { add, list },
});
