---
role: user
model: fast
readonly: true
---

Human gate: the architecture of task `{{id}}` — **{{title}}** — has been critiqued and
reviewed and now needs the user's approval. The board says: {{reason}}.

## Task

{{description}}

Acceptance criteria:

{{criteria}}

Branch: `{{branch}}` · Architecture revision: {{revision}}

## Architecture

{{doc}}

## Notes on the architecture

{{notes}}

## What to do

Do not dispatch anyone. Show the user the architecture above, summarize what the critic and
reviewer concluded from the notes, and ask one question: approve this design and start
building, or send it back with feedback? Wait for the answer. After approval the next step is
slicing; no more human gates until verification.

## Record

If the user approves:

```sh
{{cli}} doc status {{id}} architecture approved
```

If the user sends it back, record their feedback (body from stdin) so the planner rewrites it:

```sh
{{cli}} note add {{id}} --author user --target architecture --verdict needs-changes <<'EOF'
<the user's feedback, verbatim where possible>
EOF
```

Return one line: `approve-architecture: approved` or `approve-architecture: sent back`.

## Repo additions

{{extra}}
