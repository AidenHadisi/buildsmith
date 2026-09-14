import type { SliceRecord, Store, TaskDoc } from "./store.ts";

export type NextAction = {
  stage: "spec" | "architecture" | "slicing" | "building" | "verify" | "done";
  action: string;
  reason: string;
  blocked?: SliceRecord[];
};

const STEPS = { draft: "critique", critiqued: "review", reviewed: "approve" } as const;

async function docStep(
  store: Store,
  taskId: string,
  kind: "spec" | "architecture",
  doc: TaskDoc | null,
): Promise<NextAction | null> {
  if (!doc || doc.kind !== kind) {
    return { stage: kind, action: `write-${kind}`, reason: `${kind} does not exist` };
  }
  if (doc.status === "approved") return null;
  const verdict = (await store.notes.list(taskId, kind)).at(-1)?.verdict;
  if (verdict === "better-design" || verdict === "needs-changes") {
    return { stage: kind, action: `write-${kind}`, reason: `${kind} sent back: ${verdict}` };
  }
  const verb = STEPS[doc.status];
  return { stage: kind, action: `${verb}-${kind}`, reason: `${kind} is ${doc.status}` };
}

export async function next(store: Store, taskId: string): Promise<NextAction> {
  await store.tasks.get(taskId);

  for (const kind of ["spec", "architecture"] as const) {
    const step = await docStep(store, taskId, kind, await store.docs.read(taskId, kind));
    if (step) return step;
  }

  const slices = await store.slices.list(taskId);
  if (slices.length === 0) {
    return { stage: "slicing", action: "add-slice", reason: "no slices yet" };
  }

  const blocked = slices.filter((s) => s.status === "blocked");
  const first = blocked[0];
  if (first) {
    return {
      stage: "building",
      action: "unblock-slice",
      reason: `slice ${first.n} is blocked`,
      blocked,
    };
  }

  const reviewing = slices.find((s) => s.status === "review");
  if (reviewing) {
    return {
      stage: "building",
      action: "review-slice",
      reason: `slice ${reviewing.n} is in review`,
    };
  }

  const unfinished = slices.find((s) => s.status !== "done");
  if (unfinished) {
    return {
      stage: "building",
      action: "work-slice",
      reason: `slice ${unfinished.n} is ${unfinished.status}`,
    };
  }

  const verification = await store.docs.read(taskId, "verification");
  if (!verification || verification.kind !== "verification") {
    return { stage: "verify", action: "write-verification", reason: "verification does not exist" };
  }
  if (verification.result !== "pass") {
    return {
      stage: "verify",
      action: "run-verification",
      reason: verification.result === "fail" ? "verification failed" : "verification has no result",
    };
  }

  return { stage: "done", action: "none", reason: "all pipeline steps complete" };
}
