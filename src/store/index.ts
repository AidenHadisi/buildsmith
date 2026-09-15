export { StoreError, type StoreErrorCode } from "./errors.ts";
export {
  addLesson,
  findRoot,
  init,
  isProjectReady,
  loadConfig,
  projectHasContent,
  readProject,
  watch,
  writeProject,
  type Config,
  type WatchEvent,
} from "./repo.ts";
export {
  createTask,
  getTask,
  listTasks,
  moveTask,
  putAsset,
  taskDir,
  updateTask,
  type TaskRecord,
} from "./tasks.ts";
export {
  docKindSchema,
  docStatusSchema,
  readDoc,
  setDocStatus,
  setVerificationResult,
  verificationResultSchema,
  writeDoc,
  type DocKind,
  type DocStatus,
  type TaskDoc,
  type VerificationResult,
} from "./docs.ts";
export {
  addSlice,
  listSlices,
  parseSlices,
  seedSlices,
  sliceStatusSchema,
  updateSlice,
  type SliceInput,
  type SliceRecord,
  type SliceStatus,
} from "./slices.ts";
export { addNote, listNotes, type NoteEntry } from "./notes.ts";
export type { Next as NextAction } from "../pipeline.ts";
export { splitFrontmatter, parseYaml } from "./files.ts";
