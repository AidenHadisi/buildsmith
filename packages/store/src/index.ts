export { StoreError, type StoreErrorCode } from "./errors.ts";
export {
  Store,
  type NextAction,
  type SliceRecord,
  type TaskDoc,
  type TaskRecord,
  type WatchEvent,
} from "./store.ts";
export { splitFrontmatter, parseYaml } from "./files.ts";
export {
  docKindSchema,
  docStatusSchema,
  sliceStatusSchema,
  verificationResultSchema,
} from "./schema.ts";
export type {
  Config,
  DocKind,
  DocStatus,
  NoteEntry,
  SliceStatus,
  VerificationResult,
} from "./schema.ts";
