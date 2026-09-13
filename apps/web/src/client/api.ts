import { hc, type InferResponseType } from "hono/client";
import type { AppType } from "../server/app.ts";

export const api = hc<AppType>("/");

export type BoardTask = InferResponseType<typeof api.api.board.$get>["tasks"][number];

export type TaskDetail = InferResponseType<(typeof api.api.tasks)[":id"]["$get"], 200>;
