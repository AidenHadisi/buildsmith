import type { BoardTask } from "./api.ts";
import { StageBadge } from "./StageBadge.tsx";

export function TaskCard({ task }: { task: BoardTask }) {
  return (
    <div className="space-y-2 rounded-md border bg-card p-3 shadow-sm">
      <p className="text-sm font-medium">{task.title}</p>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{task.id.slice(-6)}</span>
        <StageBadge stage={task.next.stage} />
      </div>
    </div>
  );
}
