import { join } from "node:path";
import * as z from "zod";
import { StoreError } from "./errors.ts";
import { nonEmpty, record, stringifyRecord, write } from "./files.ts";
import { parseSlices, seedSlices } from "./slices.ts";
import { taskDir } from "./tasks.ts";

export const docStatusSchema = z.enum(["draft", "critiqued", "reviewed", "approved"]);
export type DocStatus = z.infer<typeof docStatusSchema>;

export const verificationResultSchema = z.enum(["pass", "fail"]);
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const docKindSchema = z.enum(["spec", "architecture", "verification"]);
export type DocKind = z.infer<typeof docKindSchema>;

const docSchema = z.looseObject({
  status: docStatusSchema.optional(),
  revision: z.number().int().positive().optional(),
  result: verificationResultSchema.optional(),
});
type DocFrontmatter = z.infer<typeof docSchema>;

export type TaskDoc = DocFrontmatter & { kind: DocKind; body: string };

const docPath = async (root: string, taskId: string, kind: DocKind) =>
  join(await taskDir(root, taskId), `${kind}.md`);

const docFile = async (root: string, taskId: string, kind: DocKind) =>
  record(await docPath(root, taskId, kind), docSchema);

const toDoc = (kind: DocKind, rec: { data: DocFrontmatter; body: string }): TaskDoc => ({
  kind,
  ...rec.data,
  body: rec.body.trimStart(),
});

export async function writeDoc(root: string, taskId: string, kind: DocKind, body: string) {
  nonEmpty(body);
  const path = await docPath(root, taskId, kind);
  const file = record(path, docSchema);
  const out = await write(path, (raw) => {
    const prev = raw === null ? undefined : file.parse(raw).data;
    const data: DocFrontmatter =
      kind === "verification"
        ? prev?.result
          ? { result: prev.result }
          : {}
        : { status: "draft", revision: (prev?.revision ?? 0) + 1 };
    return stringifyRecord(data, body);
  });
  return { kind, ...file.parse(out).data, body };
}

export async function readDoc(root: string, taskId: string, kind: DocKind) {
  const rec = await (await docFile(root, taskId, kind)).read();
  return rec && toDoc(kind, rec);
}

export async function setDocStatus(
  root: string,
  taskId: string,
  kind: "spec" | "architecture",
  status: DocStatus,
) {
  const file = await docFile(root, taskId, kind);
  const seeding = kind === "architecture" && status === "approved";
  const body = seeding ? ((await file.read())?.body ?? "") : null;
  if (body !== null) parseSlices(body);
  const rec = await file.patch((data) => {
    const current = data.status;
    if (
      current &&
      docStatusSchema.options.indexOf(status) <= docStatusSchema.options.indexOf(current)
    ) {
      throw new StoreError("conflict", `cannot move ${kind} status from ${current} to ${status}`);
    }
    return { status };
  });
  if (body !== null) await seedSlices(root, taskId, body);
  return toDoc(kind, rec);
}

export async function setVerificationResult(
  root: string,
  taskId: string,
  result: VerificationResult,
) {
  const file = await docFile(root, taskId, "verification");
  return toDoc("verification", await file.patch({ result }));
}
