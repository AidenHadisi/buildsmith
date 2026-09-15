# Buildsmith

**A build pipeline for coding agents that they can't skip.**

Spec → critique → review → approval → architecture → slices → code review → live verification. Every step is a file on disk, the next step is derived from those files, and each agent is told exactly what to do and how to record the result. Your agent runs the loop; the board keeps it honest.

![The Buildsmith board](docs/images/board.png)

## The problem

Coding agents are good at steps and bad at processes. Tell one to "write a spec, get it critiqued, iterate until it holds, then get it reviewed, then build it slice by slice with a review after each" and three things happen:

- **It forgets.** By the fourth step the instructions from the first are out of context. The critique loop runs once instead of until it holds. The review gets skipped because "the code looked fine".
- **It grades its own homework.** The same agent that wrote the design critiques it, finds it excellent, and moves on.
- **It carries everything.** The orchestrator holds every spec, every critique, every diff in one context window, and quality degrades as the window fills.

Skills and prompt files help, but they are advice. Nothing stops an agent from deciding it has done enough.

## What Buildsmith does

Buildsmith moves the process out of the agent's head and into a small state machine over markdown files.

- **The board is the state.** A task is a folder under `.buildsmith/` with `spec.md`, `architecture.md`, slices, notes and a verification doc. Status lives in frontmatter. It's git-friendly, diffable and human-readable.
- **`store.next()` derives the due step** from those files. A spec in `draft` needs critique. A critic note saying `better-design` sends it back for rewrite. A slice in `review` needs a code review. There is no "skip".
- **Every role gets a brief.** `buildsmith brief <id>` renders the prompt for whatever is due: the task, the relevant docs, the prior notes, the judgment standard, and the exact commands to record the outcome. Fresh subagents, one per step, each with full context and no memory of the last one.
- **Roles record their own verdicts** through the CLI. A critic writes `note add --verdict holds` and advances the doc; a coder marks its slice `review` with a commit sha; a reviewer marks it `done` or sends it back. The board only moves when someone with that role says so.
- **Humans gate what matters.** You approve the spec and the architecture. Everything between is agents pressure-testing each other's work.

## How the loop looks

Your main agent (in Cursor, Claude Code or Codex) runs one command and does what it says:

```
buildsmith step <id>
```

| It returns | Meaning                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| `self`     | A brief for the main agent: interview you for the spec, rule on a critique, ask for approval. |
| `dispatch` | Agent type, model and a one-line prompt for a fresh subagent. It runs its brief and records.  |
| `ask`      | A cap was hit (revision 5, three review bounces, two failed verifications, stalled board).    |
| `done`     | Every step is complete.                                                                       |

The main agent is the planner: it writes the spec and architecture with you, and when a critic proposes a better design it rules **Adopt** or **Reject** per point, with reasons, recorded as a note. The next critic sees those rulings and can't re-raise a settled point without new evidence. Critiquing, reviewing, coding, code-reviewing and testing are always dispatched; the main agent never grades its own work.

<p align="center">
  <img src="docs/images/task-notes.png" width="760" alt="A task's notes: critic proposes a better design, the planner rules Adopt/Reject per point, a fresh critic holds, the reviewer passes">
</p>

## Pipeline

```
spec          write → critique ⟲ → review → approve (you)
architecture  write → critique ⟲ → review → approve (you)
slices        add all → for each: code → review ⟲ → done
verify        write plan → run live → pass | fail (adds a fix slice)
```

`⟲` means the loop repeats until a fresh critic returns `holds` or a fresh reviewer returns `pass`. A rewrite bumps the doc's revision and resets it to `draft`, so nothing that changed goes un-critiqued.

## Install

Not on npm yet. Either download a binary or link from source.

**Binary.** Grab the one for your platform from [Releases](https://github.com/AidenHadisi/buildsmith/releases) (macOS arm64/x64, Linux x64/arm64, Windows x64):

```sh
chmod +x buildsmith-darwin-arm64
mv buildsmith-darwin-arm64 /usr/local/bin/buildsmith     # anywhere on PATH; on Windows keep the .exe
```

The binaries are not code-signed; if macOS refuses to run one downloaded through a browser, clear the quarantine flag with `xattr -d com.apple.quarantine /usr/local/bin/buildsmith`.

**From source.** Requires [Bun](https://bun.sh) 1.4.2+:

```sh
git clone https://github.com/AidenHadisi/buildsmith && cd buildsmith
bun install && bun run build         # builds the board UI
cd packages/cli && bun link          # `buildsmith` on PATH
```

Then in the repo you want to work on:

```sh
buildsmith init                      # creates .buildsmith/
buildsmith setup cursor              # or claude, codex; installs the plugin
```

Fill in `.buildsmith/project.md` (how to run, check and live-test your project) — every brief includes it.

## Use

```sh
buildsmith task create --title "Invoice PDF export" \
  --description "Let an org download a filed invoice as a PDF" \
  "GET /invoices/:id.pdf returns application/pdf" \
  "Totals match the invoice record" \
  "Cross-org ids return 404"
```

Then ask your agent to run the `buildsmith` skill on that task. It will interview you for the spec, run the critique loop, ask you to approve, design the architecture, run that loop, ask again, and build. Watch it on the board:

```sh
buildsmith board                     # serves this repo's board on http://127.0.0.1:3000 and opens it
```

`--port <n>` picks the port (a taken port falls back to a free one); `--no-open` skips the browser. Ctrl-C stops it.

Everything is also a CLI command, so you can drive or inspect any step by hand:

```sh
buildsmith next <id>                 # what's due and why
buildsmith brief <id>                # the prompt the next role would get
buildsmith note list <id> --target spec
buildsmith slice list <id>
```

`<id>` is a task UUID or any unique prefix of one. Output is JSON when piped, text in a terminal.

## Customize

**Prompts.** Every step's brief is a markdown template. Eject one into your repo and edit it; `{{extra}}` lets you append without ejecting.

```sh
buildsmith prompt list               # 14 actions, built-in or repo
buildsmith prompt eject critique-spec
# edit .buildsmith/prompts/critique-spec.md, or add critique-spec.extra.md
buildsmith prompt diff critique-spec
```

**Models.** Templates name a tier; map tiers to your host's models in `.buildsmith/config.yml`:

```yaml
models:
  strong: claude-opus-4.6
  fast: gemini-3.5-flash
```

**Columns.** Also in `config.yml`. Defaults to `backlog, planning, building, review, done`.

See [docs/how-it-works.md](docs/how-it-works.md) for the state machine, note vocabulary, template slots and file layout.

## Layout

```
packages/store    Markdown + YAML store, store.next(), file watcher
packages/cli      buildsmith CLI, prompt templates, plugin (skill + agents)
packages/cli/board Local board (Hono + React), read-only view of .buildsmith/
```

## Status

Pre-release. The loop is proven end to end with real subagents, and the file formats are stable enough to dogfood. Expect the prompts to keep improving and an npm publish once they settle.

## License

[MIT](LICENSE) © Aiden Hadisi
