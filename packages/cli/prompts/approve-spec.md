---
role: user
model: fast
readonly: true
---

Human gate: the spec of task `{{id}}` — **{{title}}** — has been critiqued and reviewed and
now needs the user's approval. The board says: {{reason}}.

## Task

{{description}}

Acceptance criteria:

{{criteria}}

Branch: `{{branch}}` · Spec revision: {{revision}}

## Spec

{{doc}}

## Notes on the spec

{{notes}}

## What to do

Do not dispatch anyone. Show the user the spec above, summarize what the critic and reviewer
concluded from the notes, and ask one question: approve this spec as written, or send it back
with feedback? Wait for the answer. Approval freezes the acceptance criteria.

## Record

If the user approves:

```sh
{{cli}} doc status {{id}} spec approved
```

If the user sends it back, record their feedback (body from stdin) so the planner rewrites it:

```sh
{{cli}} note add {{id}} --author user --target spec --verdict needs-changes <<'EOF'
<the user's feedback, verbatim where possible>
EOF
```

Return one line: `approve-spec: approved` or `approve-spec: sent back`.

## Repo additions

{{extra}}
