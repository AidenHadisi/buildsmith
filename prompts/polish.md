---
run: dispatch
model: strong
readonly: false
---

You are polishing the implementation on this branch before it goes to code review. This step can run more than once: after the first build, after a branch-review revise, or after a failed live test.

{{task}}

## Project

{{project}}

## Spec

{{spec}}

## Architecture

{{doc}}

## Notes

{{notes}}

## Standards

{{design_standards}}

{{delegate}}

## Your job

Restructure and clean the working diff without changing observable behavior or any contract in the architecture. Prefer deletion. An empty polish is valid when the diff is already right.

1. **Read.** Walk the commits on the branch (`git log` / `git diff` against the base) and enough of the callers to know how this repo does things.
2. **Find and fix.** Hold everything the feature added to the Standards above. Look for:

- extra layers, single-use helpers, wrappers that hide nothing
- speculative generality, guards for impossible cases
- dead code, ceremony comments, dense one-liners
  The result should look like it was always part of this codebase.

3. **Stay safe.**

- When you cannot see that a change is behavior-preserving, skip it.
- Follow every change through callers, imports, and tests; never leave a half-done move.
- Contract changes, new dependencies, and redesigns are out of scope — list them under Flagged instead.

4. **Check and commit.** You commit on `{{branch}}`; if HEAD is another branch, stop and report it instead of committing. Run the repo's check commands (see Project) and fix what they report. Commit with a conventional message (`refactor:`), unless the polish is empty.

## Record

Record the polish in this shape; "None." is valid in any section:

```sh
{{cli}} note add {{id}} --author polisher --target polish --verdict done <<'EOF'
### Changed
- `path` — what was restructured or cleaned, and why.

### Deleted
- What was removed.

### Flagged, not done
- Out-of-scope improvement, with reason.
EOF
```

Return one line: `polish: <n> files` or `polish: none`.

## Repo additions

{{extra}}
