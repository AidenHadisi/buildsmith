import { findRoot } from "../store/index.ts";
import { join } from "node:path";
import { defineCommand } from "citty";
import { createApp, type AppType } from "../board/app.ts";
import { distDir } from "../paths.ts";

export default defineCommand({
  meta: { name: "board", description: "Serve this repo's board on localhost and open it" },
  args: {
    port: {
      type: "string",
      description: "Port to listen on; falls back to a free port when taken",
      default: "3000",
    },
    open: {
      type: "boolean",
      description: "Open the board in the default browser",
      negativeDescription: "Only print the URL",
      default: true,
    },
  },
  run: async ({ args }) => {
    const root = findRoot();
    // BUILDSMITH_DIST is a test-only override so the command runs without a real build.
    const dist = process.env.BUILDSMITH_DIST ?? distDir;
    if (!(await Bun.file(join(dist, "index.html")).exists())) {
      throw new Error("board assets not built; run `bun run build`");
    }
    const server = listen(createApp(root, dist), Number(args.port));
    console.log(`Board: ${server.url.origin}`);
    if (args.open) openBrowser(server.url.origin);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
    server.stop(true);
  },
});

function listen(app: AppType, port: number) {
  try {
    return Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "EADDRINUSE")) throw err;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    console.error(`port ${port} in use, using ${server.port}`);
    return server;
  }
}

const OPENERS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["open"],
  win32: ["cmd", "/c", "start", ""],
};

function openBrowser(url: string) {
  const opener = OPENERS[process.platform] ?? ["xdg-open"];
  try {
    Bun.spawn([...opener, url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // no browser opener on this machine; the URL is already printed
  }
}
