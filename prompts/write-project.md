---
run: dispatch
model: strong
readonly: false
---

You are researching this repository so later briefs know how to run, test, ship, and observe it. The board says: {{reason}}.

## Current project.md

{{project}}

{{delegate}}

## Your job

Write `.buildsmith/project.md` from evidence in the repo. It is a repo-level document.

If the document above already has real content, keep every fact that is still true and rewrite the rest. Never shrink a filled document into a stub.

### 1. Research

Read before you write:

- README, CONTRIBUTING, package manifests, Makefiles, `scripts/`
- Dockerfiles, compose files, Procfiles, `.env.example`
- `.github/`, deploy and CI config, Terraform / Pulumi / CDK / Helm
- commitlint, git hooks, recent `git log`
- the dev and test commands the repo actually uses
- logging dashboards referenced in docs

Open neighboring services only when needed and when this repo points at them.

### 2. Write

Rules:

- Do not ask the user anything.
- Do not invent URLs, accounts, clusters, or log queries you did not find. When a section cannot be proven from the repo or its docs, write a bullet starting with `Unknown:` that says what is missing.
- Commands are copy-pasteable. Prefer bullets over prose.

Cover each section with concrete commands, URLs, and paths:

1. **What it is** — one or two paragraphs before any heading: the product, who it serves, the main runtime (language, app server, jobs).
2. **Run** — install deps; start locally; host, port, and URL; how to open it in a browser when there is a UI.
3. **Check** — lint, typecheck, unit and integration tests; the command that must pass before a slice is done.
4. **Live test** — how to bring the real process up and reach it: command, host/port, browser URL, a health-check request. A shared test account only if the whole repo uses one. No per-feature stop-before steps — those belong in each task's spec.
5. **Deploy** — how it ships (CI job, CLI, pipeline) and how internal vs production are promoted.
6. **Infra** — hosts, datastores, queues, object storage, third parties this process talks to.
7. **Logs** — where to read logs locally and in each deployed environment (command, dashboard, or query).
8. **Environment** — what local / dev / staging / prod connect to; secrets and `.env`; feature flags.
9. **Data safety** — standing repo rules: which environments are safe to live-test against, local DBs and fixtures, what must never be pointed at from a laptop. Not per-flow outbound actions.
10. **Commits** — message format and style this repo uses (conventional commits, scopes, trailers, an example).
11. **Conventions** — how code is written here, one bullet per rule with the file that shows it: how errors are raised and handled, naming, where tests live and how they are named, module and folder layout, formatting and lint config. Only rules the code actually follows.
12. **Lessons** — keep existing lesson bullets. If there are none, leave the heading present and empty.

Use exactly these headings, in this order:

```md
<what it is>

## Run

- …

## Check

- …

## Live test

- …

## Deploy

- …

## Infra

- …

## Logs

- …

## Environment

- …

## Data safety

- …

## Commits

- …

## Conventions

- …

## Lessons
```

## Record

Save the document with this command; put the full markdown between the `EOF` lines. Never edit `.buildsmith/project.md` by hand.

```sh
{{cli}} project write <<'EOF'
<the document>
EOF
```

Return one line: `project written`.

## Repo additions

{{extra}}
