import { describe, expect, test } from "bun:test";
import { decide, type Snapshot } from "./pipeline.ts";

const empty: Snapshot = {
  project: true,
  spec: null,
  architecture: null,
  slices: [],
  lastEnd: null,
  branchRevises: 0,
  verificationFails: 0,
  verification: null,
};
const approved = { status: "approved" as const };
const slice = (n: number, status: "todo" | "doing" | "review" | "done" | "blocked") => ({
  n,
  title: `S${n}`,
  status,
});
const polishDone = { target: "polish", verdict: "done" };
const branchPass = { target: "branch", verdict: "pass" };

describe("next", () => {
  test("project.md before spec", () => {
    expect(decide({ ...empty, project: false })).toMatchObject({
      stage: "project",
      action: "write-project",
      reason: "project.md is missing or empty",
    });
    expect(decide(empty).action).toBe("write-spec");
  });

  test("spec then architecture then slices then verify", () => {
    expect(decide(empty).action).toBe("write-spec");
    expect(decide({ ...empty, spec: { status: "draft" } }).action).toBe("review-spec");
    expect(decide({ ...empty, spec: { status: "critiqued" } }).action).toBe("review-spec");
    expect(decide({ ...empty, spec: { status: "reviewed" } }).action).toBe("approve-spec");
    expect(decide({ ...empty, spec: approved }).action).toBe("write-architecture");
    const docsApproved = { ...empty, spec: approved, architecture: approved };
    expect(decide(docsApproved).action).toBe("run-verification");
    expect(decide({ ...docsApproved, slices: [slice(1, "todo")] }).action).toBe("work-slice");
  });

  test("send-back beats status", () => {
    const spec = { status: "draft" as const, lastVerdict: "better-design" };
    expect(decide({ ...empty, spec })).toMatchObject({
      action: "write-spec",
      reason: "spec sent back: better-design",
    });
    expect(
      decide({
        ...empty,
        spec: { status: "critiqued", lastVerdict: "needs-changes" },
      }).action,
    ).toBe("write-spec");
  });

  test("approved ignores send-back", () => {
    expect(
      decide({
        ...empty,
        spec: { status: "approved", lastVerdict: "needs-changes" },
      }).action,
    ).toBe("write-architecture");
  });

  test("slice priority: blocked, then open", () => {
    const ready = { ...empty, spec: approved, architecture: approved };
    expect(
      decide({
        ...ready,
        slices: [slice(1, "review"), slice(2, "blocked"), slice(3, "todo")],
      }),
    ).toMatchObject({
      action: "unblock-slice",
      reason: "slice 2 is blocked",
      blocked: [slice(2, "blocked")],
    });
    expect(decide({ ...ready, slices: [slice(1, "todo"), slice(2, "review")] }).action).toBe(
      "work-slice",
    );
    expect(decide({ ...ready, slices: [slice(1, "doing")] }).reason).toBe("slice 1 is doing");
    expect(decide({ ...ready, slices: [slice(1, "review")] }).reason).toBe("slice 1 is review");
  });

  test("polish then branch review then verification", () => {
    const built = {
      ...empty,
      spec: approved,
      architecture: approved,
      slices: [slice(1, "done")],
    };
    expect(decide(built)).toMatchObject({
      action: "polish",
      reason: "slices are done",
    });
    expect(decide({ ...built, lastEnd: polishDone })).toMatchObject({
      action: "review-branch",
      reason: "diff is polished",
    });
    expect(decide({ ...built, lastEnd: branchPass })).toMatchObject({
      action: "run-verification",
      reason: "verification has not been run",
    });
    expect(decide({ ...built, lastEnd: branchPass, verification: {} }).reason).toBe(
      "verification has no result",
    );
    expect(decide({ ...built, lastEnd: { target: "branch", verdict: "revise" } })).toMatchObject({
      action: "work-branch",
      reason: "branch review sent back",
    });
    expect(decide({ ...built, lastEnd: { target: "branch", verdict: "done" } })).toMatchObject({
      action: "polish",
      reason: "revision is coded",
    });
    expect(
      decide({ ...built, lastEnd: { target: "verification", verdict: "fail" } }),
    ).toMatchObject({
      action: "polish",
      reason: "verification failed",
    });
    expect(decide({ ...built, lastEnd: branchPass, verification: { result: "fail" } }).reason).toBe(
      "verification failed",
    );
    expect(
      decide({ ...built, lastEnd: branchPass, verification: { result: "pass" } }),
    ).toMatchObject({
      stage: "done",
      action: "none",
    });
  });

  test("caps attach ask without changing the action", () => {
    expect(decide({ ...empty, spec: { status: "draft", revision: 5 } })).toMatchObject({
      action: "review-spec",
      ask: expect.stringContaining("revision 5"),
    });
    expect(decide({ ...empty, spec: { status: "draft", revision: 4 } }).ask).toBeUndefined();
    expect(
      decide({
        ...empty,
        spec: approved,
        architecture: { status: "draft", revision: 5 },
      }),
    ).toMatchObject({
      action: "review-architecture",
      ask: expect.stringContaining("architecture has reached revision 5"),
    });
    const built = { ...empty, spec: approved, architecture: approved, slices: [slice(1, "done")] };
    expect(decide({ ...built, lastEnd: polishDone, branchRevises: 3 })).toMatchObject({
      action: "review-branch",
      ask: expect.stringContaining("sent back 3 times"),
    });
    expect(decide({ ...built, lastEnd: branchPass, verificationFails: 2 })).toMatchObject({
      action: "run-verification",
      ask: expect.stringContaining("failed 2 times"),
    });
  });
});
