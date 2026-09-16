## Findings

Facts about this repo recorded by earlier steps of this task: paths, current behavior, siblings, conventions, packages present, and things checked and found absent. Later entries win over earlier ones.

{{findings}}

## Delegation

You own the judgment in this brief; subagents own the reading. Anything that is reading code, searching the repo, or researching goes to a read-only subagent — several in parallel when the questions are independent, each with a complete brief and one focused question. Read a file yourself only when a decision depends on its exact contents.

Read Findings first. Dispatch readers only for questions Findings does not answer, and record what they return before you use it, so no later step has to establish it again:

```sh
{{cli}} note add {{id}} --author <your role> --target findings <<'EOF'
- <fact about the repo, with the path or command that shows it>
EOF
```

Record facts, not opinions about the task; only what Findings does not already say; and things you checked and found absent. When an entry is wrong, add a new one that names what it corrects.

Send researchers to the web when you need to know whether a well-maintained package already does a job, when an API, symbol, or config is unfamiliar in this repo, or when the user names something you do not recognize. Verify before you assume; never invent by analogy.
