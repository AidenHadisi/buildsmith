import { readDoc, type DocStatus, type TaskDoc, type VerificationResult } from "./store/docs.ts";
import { listNotes } from "./store/notes.ts";
import { isProjectReady } from "./store/repo.ts";
import { listSlices, type SliceStatus } from "./store/slices.ts";

export type Action =
  | "write-project"
  | "write-spec"
  | "review-spec"
  | "approve-spec"
  | "write-architecture"
  | "review-architecture"
  | "approve-architecture"
  | "work-slice"
  | "unblock-slice"
  | "polish"
  | "review-branch"
  | "work-branch"
  | "run-verification"
  | "none";

export type Stage =
  | "project"
  | "spec"
  | "architecture"
  | "building"
  | "polish"
  | "review"
  | "verify"
  | "done";

export type Slice = { n: number; title: string; status: SliceStatus };
export type Doc = { status: DocStatus; revision?: number; lastVerdict?: string } | null;

export type Snapshot = {
  project: boolean;
  spec: Doc;
  architecture: Doc;
  slices: Slice[];
  lastEnd: { target: string; verdict?: string } | null;
  branchRevises: number;
  verificationFails: number;
  verification: { result?: VerificationResult } | null;
};

export type Next = {
  stage: Stage;
  action: Action;
  reason: string;
  blocked?: Slice[];
  ask?: string;
};

type Rule = { test: (s: Snapshot) => unknown; run: (s: Snapshot, hit: unknown) => Next };

function when<T>(
  test: (s: Snapshot) => T,
  result: Next | ((s: Snapshot, hit: NonNullable<T>) => Next),
): Rule {
  const run = typeof result === "function" ? result : () => result;
  return { test, run: run as Rule["run"] };
}

function sendBack(doc: Doc) {
  return (
    doc != null &&
    doc.status !== "approved" &&
    (doc.lastVerdict === "better-design" || doc.lastVerdict === "needs-changes")
  );
}

function endIs(target: string, verdict: string) {
  return (s: Snapshot) => s.lastEnd?.target === target && s.lastEnd.verdict === verdict;
}

function doc(kind: "spec" | "architecture"): Rule[] {
  return [
    when((s) => !s[kind], {
      stage: kind,
      action: `write-${kind}`,
      reason: `${kind} does not exist`,
    }),
    when(
      (s) => sendBack(s[kind]),
      (s) => ({
        stage: kind,
        action: `write-${kind}`,
        reason: `${kind} sent back: ${s[kind]!.lastVerdict}`,
      }),
    ),
    when(
      (s) => s[kind]?.status === "draft" || s[kind]?.status === "critiqued",
      (s) => ({
        stage: kind,
        action: `review-${kind}`,
        reason: s[kind]!.status === "critiqued" ? `${kind} is critiqued` : `${kind} is draft`,
      }),
    ),
    when((s) => s[kind]?.status === "reviewed", {
      stage: kind,
      action: `approve-${kind}`,
      reason: `${kind} is reviewed`,
    }),
  ];
}

function slice(status: SliceStatus | "open") {
  return (s: Snapshot) =>
    status === "open"
      ? s.slices.find((x) => x.status !== "done")
      : s.slices.find((x) => x.status === status);
}

const pipeline: Rule[] = [
  when((s) => !s.project, {
    stage: "project",
    action: "write-project",
    reason: "project.md is missing or empty",
  }),
  ...doc("spec"),
  ...doc("architecture"),
  when(slice("blocked"), (s, x) => ({
    stage: "building",
    action: "unblock-slice",
    reason: `slice ${x.n} is blocked`,
    blocked: s.slices.filter((y) => y.status === "blocked"),
  })),
  when(slice("open"), (_s, x) => ({
    stage: "building",
    action: "work-slice",
    reason: `slice ${x.n} is ${x.status}`,
  })),
  when(endIs("branch", "revise"), {
    stage: "building",
    action: "work-branch",
    reason: "branch review sent back",
  }),
  when(endIs("branch", "done"), {
    stage: "polish",
    action: "polish",
    reason: "revision is coded",
  }),
  when(endIs("verification", "fail"), {
    stage: "polish",
    action: "polish",
    reason: "verification failed",
  }),
  when(endIs("polish", "done"), {
    stage: "review",
    action: "review-branch",
    reason: "diff is polished",
  }),
  when((s) => s.slices.length > 0 && !s.lastEnd, {
    stage: "polish",
    action: "polish",
    reason: "slices are done",
  }),
  when(
    (s) => s.verification?.result !== "pass",
    (s) => ({
      stage: "verify",
      action: "run-verification",
      reason: !s.verification
        ? "verification has not been run"
        : s.verification.result === "fail"
          ? "verification failed"
          : "verification has no result",
    }),
  ),
  when(() => true, {
    stage: "done",
    action: "none",
    reason: "all pipeline steps complete",
  }),
];

export function decide(s: Snapshot): Next {
  for (const rule of pipeline) {
    const hit = rule.test(s);
    if (hit) {
      const due = rule.run(s, hit);
      const ask = askFor(s, due.action);
      return ask ? { ...due, ask } : due;
    }
  }
  throw new Error("pipeline exhausted");
}

function askFor(s: Snapshot, action: Action): string | undefined {
  if (action.endsWith("-spec") || action.endsWith("-architecture")) {
    const kind = action.endsWith("-spec") ? "spec" : "architecture";
    const revision = s[kind]?.revision;
    if (revision != null && revision >= 5) {
      return `${kind} has reached revision ${revision}; discuss with the user whether to approve it as-is or narrow the task.`;
    }
  }
  if ((action === "review-branch" || action === "work-branch") && s.branchRevises >= 3) {
    return `the branch has been sent back ${s.branchRevises} times; discuss with the user whether to split the work or change its approach.`;
  }
  if (action === "run-verification" && s.verificationFails >= 2) {
    return `verification has failed ${s.verificationFails} times; discuss with the user what is broken before running it again.`;
  }
}

const END_TARGETS = new Set(["polish", "branch", "verification"]);

export async function next(root: string, taskId: string): Promise<Next> {
  const [project, spec, architecture, slices, verification, notes] = await Promise.all([
    isProjectReady(root),
    readDoc(root, taskId, "spec"),
    readDoc(root, taskId, "architecture"),
    listSlices(root, taskId),
    readDoc(root, taskId, "verification"),
    listNotes(root, taskId),
  ]);
  const doc = (d: TaskDoc | null, kind: string): Doc =>
    d?.status
      ? {
          status: d.status,
          revision: d.revision,
          lastVerdict: notes.findLast((n) => n.target === kind)?.verdict,
        }
      : null;
  const verdicts = (target: string, verdict: string) =>
    notes.filter((n) => n.target === target && n.verdict === verdict).length;
  const lastEnd = notes.findLast((n) => END_TARGETS.has(n.target));
  return decide({
    project,
    spec: doc(spec, "spec"),
    architecture: doc(architecture, "architecture"),
    slices: slices.map(({ n, status, title }) => ({ n, status, title })),
    lastEnd: lastEnd ? { target: lastEnd.target, verdict: lastEnd.verdict } : null,
    branchRevises: verdicts("branch", "revise"),
    verificationFails: verdicts("verification", "fail"),
    verification: verification ? { result: verification.result } : null,
  });
}
