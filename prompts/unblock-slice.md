---
role: user
model: fast
readonly: true
---

Human gate: a slice is blocked and needs a decision only the user can make.

{{task}}

## Blocked slice

{{slice}}

## Notes

{{notes}}

## Architecture

{{doc}}

## Your job

Do not dispatch anyone. N below is the slice number shown above.

1. Show the user the coder's blocking note — the newest note without a verdict states the problem and the options.
2. If the resolution would change the architecture, say so. The user may prefer to send the architecture back rather than patch around it:

   ```sh
   {{cli}} note add {{id}} --author user --target architecture --verdict needs-changes <<'EOF'
   <the user's feedback>
   EOF
   ```

3. Ask what to do and wait for the answer.

## Record

If the user resolves it, record the decision and return the slice to the queue:

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
