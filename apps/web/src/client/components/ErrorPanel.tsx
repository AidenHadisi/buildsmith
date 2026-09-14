import { Button } from "@/components/ui/button.tsx";

export function ErrorPanel({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
      <p className="text-sm font-medium text-destructive">Something went wrong</p>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
