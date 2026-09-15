import {
  docKindSchema,
  docStatusSchema,
  findRoot,
  readDoc,
  setDocStatus,
  setVerificationResult,
  verificationResultSchema,
  writeDoc,
} from "../store/index.ts";
import { defineCommand } from "citty";

const write = defineCommand({
  meta: { name: "write", description: "Write a task document" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    kind: {
      type: "positional",
      description: `Document kind (${docKindSchema.options.join("|")})`,
      required: true,
    },
  },
  run: async ({ args }) => {
    const { kind } = args;
    if (kind !== "spec" && kind !== "architecture" && kind !== "verification") {
      throw new Error(`invalid kind ${kind}: expected spec|architecture|verification`);
    }
    return writeDoc(findRoot(), args.id, kind, await Bun.stdin.text());
  },
});

const read = defineCommand({
  meta: { name: "read", description: "Read a task document" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    kind: {
      type: "positional",
      description: `Document kind (${docKindSchema.options.join("|")})`,
      required: true,
    },
  },
  run: ({ args }) => {
    const { kind } = args;
    if (kind !== "spec" && kind !== "architecture" && kind !== "verification") {
      throw new Error(`invalid kind ${kind}: expected spec|architecture|verification`);
    }
    return readDoc(findRoot(), args.id, kind);
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Advance a document's status" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    kind: { type: "positional", description: "Document kind (spec|architecture)", required: true },
    status: {
      type: "positional",
      description: `New status (${docStatusSchema.options.join("|")})`,
      required: true,
    },
  },
  run: ({ args }) => {
    const { kind, status } = args;
    if (kind !== "spec" && kind !== "architecture") {
      throw new Error(`invalid kind ${kind}: expected spec|architecture`);
    }
    if (
      status !== "draft" &&
      status !== "critiqued" &&
      status !== "reviewed" &&
      status !== "approved"
    ) {
      throw new Error(`invalid status ${status}: expected draft|critiqued|reviewed|approved`);
    }
    return setDocStatus(findRoot(), args.id, kind, status);
  },
});

const result = defineCommand({
  meta: { name: "result", description: "Record the verification result" },
  args: {
    id: { type: "positional", description: "Task id or unique prefix", required: true },
    result: {
      type: "positional",
      description: `Verification result (${verificationResultSchema.options.join("|")})`,
      required: true,
    },
  },
  run: ({ args }) => {
    const { result } = args;
    if (result !== "pass" && result !== "fail") {
      throw new Error(`invalid result ${result}: expected pass|fail`);
    }
    return setVerificationResult(findRoot(), args.id, result);
  },
});

export default defineCommand({
  meta: { name: "doc", description: "Write, read, and advance task documents" },
  subCommands: { write, read, status, result },
});
