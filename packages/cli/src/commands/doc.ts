import { docKindSchema, docStatusSchema, verificationResultSchema } from "@buildsmith/store";
import { defineCommand } from "citty";
import { act, asEnum, body } from "../io.ts";

const write = defineCommand({
  meta: { name: "write", description: "Write a task document" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    kind: {
      type: "positional",
      description: `Document kind (${docKindSchema.options.join("|")})`,
      required: true,
    },
    file: { type: "string", description: "Read the body from a file instead of stdin" },
  },
  run: act(async (store, args) =>
    store.writeDoc(
      args.id,
      asEnum("kind", args.kind, docKindSchema.options),
      await body(args.file),
    ),
  ),
});

const read = defineCommand({
  meta: { name: "read", description: "Read a task document" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    kind: {
      type: "positional",
      description: `Document kind (${docKindSchema.options.join("|")})`,
      required: true,
    },
  },
  run: act((store, args) =>
    store.readDoc(args.id, asEnum("kind", args.kind, docKindSchema.options)),
  ),
});

const status = defineCommand({
  meta: { name: "status", description: "Advance a document's status" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    kind: { type: "positional", description: "Document kind (spec|architecture)", required: true },
    status: {
      type: "positional",
      description: `New status (${docStatusSchema.options.join("|")})`,
      required: true,
    },
  },
  run: act((store, args) =>
    store.setDocStatus(
      args.id,
      asEnum("kind", args.kind, ["spec", "architecture"]),
      asEnum("status", args.status, docStatusSchema.options),
    ),
  ),
});

const result = defineCommand({
  meta: { name: "result", description: "Record the verification result" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix/suffix", required: true },
    result: {
      type: "positional",
      description: `Verification result (${verificationResultSchema.options.join("|")})`,
      required: true,
    },
  },
  run: act((store, args) =>
    store.setVerificationResult(
      args.id,
      asEnum("result", args.result, verificationResultSchema.options),
    ),
  ),
});

export default defineCommand({
  meta: { name: "doc", description: "Write, read, and advance task documents" },
  subCommands: { write, read, status, result },
});
