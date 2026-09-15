import { Badge } from "@/components/ui/badge.tsx";
import type { BoardTask } from "../api.ts";
import { label } from "../label.ts";

type Stage = BoardTask["next"]["stage"];

const styles: Record<Stage, string> = {
  project: "bg-info/10 text-info",
  spec: "bg-info/10 text-info",
  architecture: "bg-info/10 text-info",
  building: "bg-warning/10 text-warning",
  polish: "bg-warning/10 text-warning",
  review: "bg-warning/10 text-warning",
  verify: "border-info/40 bg-transparent text-info",
  done: "bg-success/10 text-success",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge className={styles[stage]}>{label(stage)}</Badge>;
}
