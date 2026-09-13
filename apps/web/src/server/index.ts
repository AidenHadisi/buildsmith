import { join } from "node:path";
import { openStore } from "@buildsmith/store";
import { createApp } from "./app.ts";

const store = await openStore(process.env.BUILDSMITH_ROOT ?? process.cwd());
const app = createApp(store, join(import.meta.dirname, "../../dist"));
Bun.serve({ fetch: app.fetch, port: 3000 });
console.log(`serving ${store.root} on http://localhost:3000`);
