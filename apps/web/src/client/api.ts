import { hc, type InferResponseType } from "hono/client";
import type { AppType } from "../server/app.ts";

export const api = hc<AppType>("/");

export type BoardTask = InferResponseType<typeof api.api.board.$get>["tasks"][number];

export async function json<T>(res: {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}): Promise<T> {
  if (!res.ok) throw new Error(`request failed with status ${res.status}`);
  return res.json();
}
