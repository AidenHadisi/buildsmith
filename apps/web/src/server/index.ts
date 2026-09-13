import { openStore } from "@buildsmith/store";
import { createApp } from "./app.ts";

const store = await openStore(process.env.BUILDSMITH_ROOT ?? process.cwd());
Bun.serve({ fetch: createApp(store).fetch, port: 3000 });
console.log(`serving ${store.root} on http://localhost:3000`);
