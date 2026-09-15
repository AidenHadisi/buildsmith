// Compiles the CLI into one executable under release/. `--target <bun-os-arch>` cross-compiles;
// without it the host platform is built as release/buildsmith. The --asset basenames must match
// what src/paths.ts joins onto pkgRoot.
import { $ } from "bun";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { target: { type: "string" } } });
const target = values.target;
const name = target ? `buildsmith-${target.replace(/^bun-/, "")}` : "buildsmith";
const outfile = `../../release/${name}${target?.includes("windows") ? ".exe" : ""}`;
const targetFlag = target ? [`--target=${target}`] : [];

await $`bun build --compile --asset ./dist --asset ./prompts --asset ./plugin ${targetFlag} ./src/main.ts --outfile ${outfile}`.cwd(
  join(import.meta.dir, ".."),
);
