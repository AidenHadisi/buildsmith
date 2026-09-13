import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { api } from "./api.ts";
import { TaskCard } from "./TaskCard.tsx";
import { TaskSheet } from "./TaskSheet.tsx";
import { useLiveRefresh } from "./useLiveRefresh.ts";

export function Board() {
  useLiveRefresh();
  const { data, error } = useQuery({
    queryKey: ["board"],
    queryFn: () => parseResponse(api.api.board.$get()),
  });

  if (error) return <p>{error.message}</p>;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="flex gap-4 overflow-x-auto">
        {data.columns.map((column) => {
          const tasks = data.tasks.filter((t) => t.column === column);
          return (
            <div key={column} className="w-72 shrink-0 rounded-lg bg-muted/40 p-3">
              <h2 className="mb-3 flex items-center justify-between text-sm font-medium capitalize">
                {column}
                <span className="text-muted-foreground">{tasks.length}</span>
              </h2>
              <div className="space-y-2">
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <TaskSheet />
    </div>
  );
}
