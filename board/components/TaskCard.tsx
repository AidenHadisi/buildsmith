import { Badge } from "@/components/ui/badge.tsx";
import type { BoardTask } from "../api.ts";
import { StageBadge } from "./StageBadge.tsx";
import { label } from "../label.ts";
import { useTaskParam } from "../hooks/useTaskParam.ts";

export function TaskCard({ task }: { task: BoardTask }) {
  const [, setTaskId] = useTaskParam();
  const blocked = task.next.blocked?.length;
  return (
    <button
      type="button"
      onClick={() => setTaskId(task.id)}
      className="w-full appearance-none space-y-2 rounded-md border border-border/70 bg-card p-3 text-left shadow-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <p className="text-sm font-medium">{task.title}</p>
      {task.next.action !== "none" && (
        <p className="text-xs text-muted-foreground">{label(task.next.action)}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
        <span className="flex items-center gap-1">
          <StageBadge stage={task.next.stage} />
          {task.next.ask ? <Badge variant="destructive">Ask</Badge> : null}
          {blocked ? <Badge variant="destructive">Blocked · {blocked}</Badge> : null}
        </span>
      </div>
    </button>
  );
}
