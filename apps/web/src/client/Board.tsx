import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { Badge } from "@/components/ui/badge.tsx";
import { api } from "./api.ts";
import { TaskCard } from "./TaskCard.tsx";
import { TaskSheet } from "./TaskSheet.tsx";
import { useLiveRefresh } from "./useLiveRefresh.ts";

export function Board() {
  const { live } = useLiveRefresh();
  const { data, error } = useQuery({
    queryKey: ["board"],
    queryFn: () => parseResponse(api.api.board.$get()),
  });

  if (error) return <p>{error.message}</p>;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center gap-3">
        <img src="/icon.png" alt="" className="h-8 w-8 rounded-md" />
        <h1 className="text-lg font-semibold">Buildsmith</h1>
        <Badge
          className={
            live
              ? "border-transparent bg-success/10 text-success"
              : "border-transparent bg-destructive/10 text-destructive"
          }
        >
          {live ? "Live" : "Reconnecting"}
        </Badge>
      </header>
      <div className="flex gap-4 overflow-x-auto">
        {data.columns.map((column) => {
          const tasks = data.tasks.filter((task) => task.column === column);
          return (
            <div key={column} className="w-72 shrink-0 rounded-lg bg-muted/40 p-3">
              <h2 className="mb-3 flex items-center justify-between text-sm font-medium capitalize">
                {column}
                <span className="text-muted-foreground">{tasks.length}</span>
              </h2>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
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
