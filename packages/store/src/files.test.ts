import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";
import {
  createExclusive,
  findRoot,
  initRoot,
  joinFrontmatter,
  patchRecord,
  readRecord,
  splitFrontmatter,
  splitSections,
  stringifyRecord,
  withLock,
  writeAtomic,
} from "./files.ts";

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
  test("round-trips comments, key order, and body", () => {
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
    const joined = joinFrontmatter(split.fm ?? "", split.body, split.eol, split.bom);
    expect(joined.startsWith("---\n")).toBe(true);
    expect(joined).toContain("body line");
  });

  test("preserves CRLF and BOM", () => {
    const raw = "\uFEFF---\r\nid: a\r\n---\r\n\r\nbody\r\n";
    const split = splitFrontmatter(raw);
    expect(split.bom).toBe(true);
    expect(split.eol).toBe("\r\n");
    const joined = joinFrontmatter(split.fm ?? "", split.body, split.eol, split.bom);
    expect(joined.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(joined).toContain("\r\n");
  });

  test("throws on unclosed frontmatter", () => {
    expect(() => splitFrontmatter("---\nid: a\n")).toThrow("unclosed frontmatter");
  });
});

describe("records", () => {
  test("patchRecord keeps YAML comments", async () => {
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
    await patchRecord(path, mini, (doc) => {
      doc.set("title", "world");
    });
    const out = await readFile(path, "utf8");
    expect(out).toContain("# keep me");
    expect(out).toContain("world");
    expect(freeze(out)).toMatchSnapshot();
  });

  test("stringifyRecord snapshot", () => {
    expect(freeze(stringifyRecord({ id: "a", title: "hi" }, "hello\n"))).toMatchSnapshot();
  });
});

describe("writes", () => {
  test("writeAtomic replaces the file", async () => {
    const dir = await tempDir();
    const path = join(dir, "a.md");
    await writeAtomic(path, "one");
    await writeAtomic(path, "two");
    expect(await readFile(path, "utf8")).toBe("two");
  });

  test("createExclusive rejects a second create", async () => {
    const dir = await tempDir();
    const path = join(dir, "a.md");
    await createExclusive(path, "one");
    expect(createExclusive(path, "two")).rejects.toThrow("file exists");
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
  test("initRoot then findRoot from a nested cwd", async () => {
    const dir = await tempDir();
    const root = await initRoot(dir);
    expect(await findRoot(join(dir, "nested", "deep"))).toBe(root);
    expect(freeze(await readFile(join(root, "config.yml"), "utf8"))).toMatchSnapshot();
    expect(await readFile(join(root, "project.md"), "utf8")).toMatchSnapshot();
  });

  test("readRecord loads a file", async () => {
    const dir = await tempDir();
    const path = join(dir, "x.md");
    await writeAtomic(path, stringifyRecord({ id: "a", title: "t" }, "body\n"));
    const rec = await readRecord(path, mini);
    expect(rec.data.id).toBe("a");
    expect(rec.body.trim()).toBe("body");
  });
});

function freeze(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
