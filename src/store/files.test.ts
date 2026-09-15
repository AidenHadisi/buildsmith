import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";
import {
  record,
  splitFrontmatter,
  splitSections,
  stringifyRecord,
  withLock,
  write,
} from "./files.ts";
import { findRoot, init } from "./repo.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "buildsmith-files-"));
  dirs.push(dir);
  return dir;
}

const mini = z.looseObject({ id: z.string(), title: z.string().optional() });

describe("splitFrontmatter", () => {
  test("keeps comments and body when splitting", () => {
    const raw = `---
id: a
# keep me
title: hello
---

body line
`;
    const split = splitFrontmatter(raw);
    expect(split.fm).toContain("# keep me");
    expect(split.body).toBe("\n\nbody line\n");
  });

  test("normalizes CRLF and BOM", () => {
    const { fm, body } = splitFrontmatter("\uFEFF---\r\nid: a\r\n---\r\n\r\nbody\r\n");
    expect(fm).toBe("id: a");
    expect(body).toBe("\n\nbody\n");
  });

  test("throws on unclosed frontmatter", () => {
    expect(() => splitFrontmatter("---\nid: a\n")).toThrow("unclosed frontmatter");
  });
});

describe("records", () => {
  test("patch keeps YAML comments", async () => {
    const dir = await tempDir();
    const path = join(dir, "task.md");
    await writeFile(
      path,
      `---
id: a
# keep me
title: hello
---

body
`,
    );
    await record(path, mini).patch({ title: "world" });
    expect(await readFile(path, "utf8")).toBe(`---
id: a
# keep me
title: world
---

body
`);
  });

  test("patch skips undefined fields", async () => {
    const dir = await tempDir();
    const path = join(dir, "task.md");
    await writeFile(
      path,
      `---
id: a
title: hello
---

body
`,
    );
    await record(path, mini).patch({ title: undefined, id: "b" });
    const out = await readFile(path, "utf8");
    expect(out).toContain("title: hello");
    expect(out).toContain("id: b");
  });

  test("stringifyRecord writes YAML and body", () => {
    expect(stringifyRecord({ id: "a", title: "hi" }, "hello\n")).toBe(`---
id: a
title: hi
---
hello
`);
  });

  test("read loads a file", async () => {
    const dir = await tempDir();
    const path = join(dir, "x.md");
    await write(path, stringifyRecord({ id: "a", title: "t" }, "body\n"));
    const rec = await record(path, mini).read();
    expect(rec?.data.id).toBe("a");
    expect(rec?.body.trim()).toBe("body");
  });
});

describe("writes", () => {
  test("write replaces the file", async () => {
    const dir = await tempDir();
    const path = join(dir, "a.md");
    await write(path, "one");
    await write(path, "two");
    expect(await readFile(path, "utf8")).toBe("two");
  });

  test("exclusive write rejects a second create", async () => {
    const dir = await tempDir();
    const path = join(dir, "a.md");
    await write(path, "one", true);
    await expect(write(path, "two", true)).rejects.toThrow("file exists");
  });
});

describe("withLock", () => {
  test("serializes concurrent work", async () => {
    const dir = await tempDir();
    let concurrent = 0;
    let max = 0;
    const run = () =>
      withLock(dir, async () => {
        concurrent += 1;
        max = Math.max(max, concurrent);
        await Bun.sleep(30);
        concurrent -= 1;
        return true;
      });
    await Promise.all([run(), run(), run()]);
    expect(max).toBe(1);
  });
});

describe("splitSections", () => {
  test("splits ## headings and ignores fenced hashes", () => {
    const md = `intro

## Acceptance criteria

- one

## Notes

\`\`\`bash
## not a heading
echo hi
\`\`\`

still notes
`;
    const { preamble, sections } = splitSections(md);
    expect(preamble).toBe("intro");
    expect(sections.map((s) => s.heading)).toEqual(["Acceptance criteria", "Notes"]);
    expect(sections[1]?.body).toContain("## not a heading");
    expect(sections[1]?.body).toContain("still notes");
  });
});

describe("root", () => {
  test("init then findRoot from a nested cwd", async () => {
    const dir = await tempDir();
    const root = await init(dir);
    expect(findRoot(join(dir, "nested", "deep"))).toBe(root);
    expect(await readFile(join(root, "config.yml"), "utf8")).toBe(`columns:
  - backlog
  - planning
  - building
  - review
  - done
verify: ""
`);
    expect(await Bun.file(join(root, "project.md")).exists()).toBe(false);
  });
});
