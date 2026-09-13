import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DetailedError } from "hono/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.tsx";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Board />
    </QueryClientProvider>
  </StrictMode>,
);
