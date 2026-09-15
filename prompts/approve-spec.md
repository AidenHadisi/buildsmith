---
run: self
---

Human gate: the spec has been reviewed and needs the user's approval.

{{task}}

## Spec

{{doc}}

## Notes

{{notes}}

## Your job

Do not dispatch anyone.

1. Show the user the spec above.
2. Summarize what the reviewer concluded from the notes: the rival they considered, and whether it is buildable as written.
3. Ask one question: approve this spec as written, or send it back with feedback?
4. Wait for the answer. Approval freezes the spec.

## Record

If the user approves:

```sh
{{cli}} doc status {{id}} spec approved
```

If the user sends it back, record their feedback so the planner rewrites it:

```sh
{{cli}} note add {{id}} --author user --target spec --verdict needs-changes <<'EOF'
<the user's feedback, verbatim where possible>
EOF
```

Return one line: `approve-spec: approved` or `approve-spec: sent back`.

## Repo additions

{{extra}}
