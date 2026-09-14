---
role: user
model: fast
readonly: true
---

Human gate: a slice of task `{{id}}` — **{{title}}** — is blocked and needs a decision only the
user can make. The board says: {{reason}}.

## Task

{{description}}

Branch: `{{branch}}`

## Blocked slice

{{slice}}

## Notes on this slice

{{notes}}

## Architecture

{{doc}}

## What to do

Do not dispatch anyone. Show the user the coder's blocking note above (the newest note without a
verdict states the problem and the options), and ask what to do. Wait for the answer. If the
resolution changes the architecture, say so — the user may prefer to send the architecture back
via `{{cli}} note add {{id}} --author user --target architecture --verdict needs-changes`
instead of patching around it.

## Record

If the user resolves it, record the decision (body from stdin; N is the slice number shown
above) and return the slice to the queue:

```sh
{{cli}} note add {{id}} --author user --target slice-N <<'EOF'
<the decision, verbatim where possible>
EOF
{{cli}} slice update {{id}} N --status todo
```

If the user cannot resolve it now, leave the slice blocked and stop.

Return one line: `slice N unblocked: <decision>` or `slice N still blocked`.

## Repo additions

{{extra}}
