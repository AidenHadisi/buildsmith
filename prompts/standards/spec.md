These standards bind everyone who writes or reviews the spec of this task. The spec is the contract the user approves; it says what and why, never how. Each role's brief says what to do when the spec falls short.

### Shape

Three sections, in order, with these headings:

- **Summary** — current state, the gap, what we add, what done looks like (one or two paragraphs)
- **Criteria** — the done-list: observable behaviors a live test can prove
- **Out of scope** — exclusions, with a reason when non-obvious

Approval freezes this spec. Later steps read Criteria from here; the task card does not carry its own list.

### What a good spec is

- Two implementers would build the same thing from it. Every criterion is an observable behavior — what a user, caller, or test can see — never an implementation step, a file, a component, or a library choice. Those belong to the architecture.
- Every criterion has a proof that can actually be run in this repo — a command, a request, a page, a log line. When the flow could reach outside the system, the criterion names the action the proof stops before.
- Nothing needed is silent, and nothing asked for is extra. Scope creep is a defect even when the extra is good.
- Failure is specified, not only success: invalid input, missing data, the empty state, and what the user sees when something goes wrong.
- Existing behavior is preserved unless a criterion says otherwise, and every such change is named.
- Precise language: no "should", "fast", "simple", "user-friendly", or "etc." A criterion is either true or false when the feature runs.
- Consistent with what the repo already does: sibling features, existing behavior, established terms. Uses the repo's names for things. Claims about current behavior are true.
- The user's intent is held, not invented. When the task leaves room for interpretation, the answer comes from the user, not from the writer.
- Decisions recorded as settled in the notes stay settled unless there is new evidence.
- The shortest spec that does all of the above. Bullets over prose.

### The ladder

Walk this list in order for anything the spec proposes to build, and stop at the first yes:

1. Does this need to exist? → no: drop it (YAGNI), unless a criterion requires it
2. Already in this codebase? → spec reuse, do not rebuild
3. Stdlib does it? → do not spec building it
4. Native platform feature? → do not spec building it
5. Installed dependency? → do not spec building it
6. Only then: spec the minimum that meets the criteria
