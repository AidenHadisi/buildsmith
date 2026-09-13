import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// The server pings every 5 s; silence means the connection died silently (the Vite
// proxy holds dead SSE streams open), so reconnect and let `open` refetch.
const WATCHDOG_MS = 15_000;

export function useLiveRefresh() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let source: EventSource;
    let watchdog: ReturnType<typeof setTimeout>;
    const connect = () => {
      source = new EventSource("/events");
      const beat = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          source.close();
          connect();
        }, WATCHDOG_MS);
      };
      const refresh = () => {
        void queryClient.invalidateQueries();
        beat();
      };
      source.addEventListener("open", refresh);
      source.addEventListener("change", refresh);
      source.addEventListener("ping", beat);
      beat();
    };
    connect();
    return () => {
      clearTimeout(watchdog);
      source.close();
    };
  }, [queryClient]);
}
