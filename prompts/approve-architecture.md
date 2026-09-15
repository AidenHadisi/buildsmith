---
run: self
---

Human gate: the architecture has been reviewed and needs the user's approval.

{{task}}

## Architecture

{{doc}}

## Notes

{{notes}}

## Your job

Do not dispatch anyone.

1. Show the user the architecture above, including the slices it will be built in.
2. Summarize what the reviewer concluded from the notes: the rival they considered, and whether it is buildable as written.
3. Ask one question: approve this design and start building, or send it back with feedback?
4. Wait for the answer. Approval creates the slices from the `## Slices` section and starts building; there are no more human gates until verification.

## Record

If the user approves:

```sh
{{cli}} doc status {{id}} architecture approved
```

If that command rejects the document (its `## Slices` section could not be parsed), do not approve by hand — send it back with the error as feedback so the planner fixes the section.

If the user sends it back, record their feedback so the planner rewrites it:

```sh
{{cli}} note add {{id}} --author user --target architecture --verdict needs-changes <<'EOF'
<the user's feedback, verbatim where possible>
EOF
```

Return one line: `approve-architecture: approved` or `approve-architecture: sent back`.

## Repo additions

{{extra}}
