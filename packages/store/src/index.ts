export { StoreError, type StoreErrorCode } from "./errors.ts";
export { openStore, type SliceRecord, type Store, type TaskDoc, type TaskRecord } from "./store.ts";
export { findRoot, initRoot, splitFrontmatter, parseYaml } from "./files.ts";
export { next, type NextAction } from "./next.ts";
export { watch, type WatchEvent } from "./watch.ts";
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
