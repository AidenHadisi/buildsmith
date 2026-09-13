import type { BoardTask } from "./api.ts";
import { StageBadge } from "./StageBadge.tsx";
import { useTaskParam } from "./useTaskParam.ts";

export function TaskCard({ task }: { task: BoardTask }) {
  const [, setTaskId] = useTaskParam();
  return (
    <button
      type="button"
      onClick={() => setTaskId(task.id)}
      className="w-full space-y-2 rounded-md border bg-card p-3 text-left shadow-sm"
    >
      <p className="text-sm font-medium">{task.title}</p>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{task.id.slice(-6)}</span>
        <StageBadge stage={task.next.stage} />
      </div>
    </button>
  );
}
