import { Badge } from "@/components/ui/badge.tsx";
import type { BoardTask } from "./api.ts";

type Stage = BoardTask["next"]["stage"];

const styles: Record<Stage, { variant: "secondary" | "default" | "outline"; className?: string }> =
  {
    spec: { variant: "secondary" },
    architecture: { variant: "secondary" },
    slicing: { variant: "default" },
    building: { variant: "default" },
    verify: { variant: "outline" },
    done: { variant: "outline", className: "border-green-600 text-green-600" },
  };

export function StageBadge({ stage }: { stage: Stage }) {
  const style = styles[stage];
  return (
    <Badge variant={style.variant} className={style.className}>
      {stage}
    </Badge>
  );
}
