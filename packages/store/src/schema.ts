import * as z from "zod";

export const DEFAULT_COLUMNS = ["backlog", "planning", "building", "review", "done"] as const;

export const docStatusSchema = z.enum(["draft", "critiqued", "reviewed", "approved"]);
export type DocStatus = z.infer<typeof docStatusSchema>;

export const sliceStatusSchema = z.enum(["todo", "doing", "review", "done", "blocked"]);
export type SliceStatus = z.infer<typeof sliceStatusSchema>;

export const verificationResultSchema = z.enum(["pass", "fail"]);
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const docKindSchema = z.enum(["spec", "architecture", "verification"]);
export type DocKind = z.infer<typeof docKindSchema>;

export const configSchema = z.looseObject({
  columns: z
    .array(z.string())
    .min(1)
    .default([...DEFAULT_COLUMNS]),
  verify: z.string().default(""),
});
export type Config = z.infer<typeof configSchema>;

export const taskSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  column: z.string(),
  order: z.string(),
  branch: z.string().optional(),
  pr: z.string().optional(),
  criteria: z.array(z.string()).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TaskFrontmatter = z.infer<typeof taskSchema>;

export const docSchema = z.looseObject({
  status: docStatusSchema.optional(),
  revision: z.number().int().positive().optional(),
  result: verificationResultSchema.optional(),
});
export type DocFrontmatter = z.infer<typeof docSchema>;

export const sliceSchema = z.looseObject({
  title: z.string(),
  status: sliceStatusSchema,
  commit: z.string().optional(),
  criteria: z.array(z.string()).default([]),
});
export type SliceFrontmatter = z.infer<typeof sliceSchema>;

export const noteEntrySchema = z.looseObject({
  at: z.iso.datetime(),
  author: z.string().min(1),
  target: z.string().min(1),
  verdict: z.string().min(1).optional(),
  body: z.string(),
});
export type NoteEntry = z.infer<typeof noteEntrySchema>;
