import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { DetailedError, parseResponse } from "hono/client";
import { MoonIcon, SunIcon } from "lucide-react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button.tsx";
import { api } from "./api.ts";
import { ErrorPanel } from "./components/ErrorPanel.tsx";
import { TaskCard } from "./components/TaskCard.tsx";
import { TaskSheet } from "./components/TaskSheet.tsx";
import { useLiveRefresh } from "./hooks/useLiveRefresh.ts";
import { getTheme, setTheme } from "./theme.ts";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = error instanceof DetailedError ? error.statusCode : undefined;
        if (typeof status === "number" && status < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

const columnsRow =
  "flex min-h-0 min-w-full flex-1 gap-4 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:overflow-x-hidden";
const column = "flex min-h-0 min-w-72 flex-1 flex-col rounded-lg bg-muted p-3 lg:min-w-0";

function App() {
  useLiveRefresh();
  const [theme, setThemeState] = useState(getTheme);
  const { data, error, refetch } = useQuery({
    queryKey: ["board"],
    queryFn: () => parseResponse(api.api.board.$get()),
  });

  return (
    <div className="flex h-svh flex-col bg-background p-6 text-foreground">
      <header className="mb-6 flex shrink-0 items-center gap-3">
        <img src="/icon.png" alt="" className="h-8 w-8 rounded-md" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Buildsmith</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            setTheme(next);
            setThemeState(next);
          }}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </Button>
      </header>
      {data ? (
        <div className={columnsRow}>
          {data.columns.map((name) => {
            const tasks = data.tasks.filter((task) => task.next.column === name);
            return (
              <div key={name} className={column}>
                <h2 className="mb-3 flex shrink-0 items-center justify-between text-sm font-medium capitalize">
                  {name}
                  <span className="text-muted-foreground">{tasks.length}</span>
                </h2>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {tasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tasks</p>
                  ) : (
                    tasks.map((task) => <TaskCard key={task.id} task={task} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : error ? (
        <ErrorPanel error={error} onRetry={refetch} />
      ) : (
        <div className={columnsRow}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={column}>
              <div className="space-y-2">
                <div className="h-16 animate-pulse rounded-md bg-card" />
                <div className="h-16 animate-pulse rounded-md bg-card" />
                <div className="h-16 animate-pulse rounded-md bg-card" />
              </div>
            </div>
          ))}
        </div>
      )}
      <TaskSheet />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
