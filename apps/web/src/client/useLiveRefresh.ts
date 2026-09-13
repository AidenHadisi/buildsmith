import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// The server pings every 5 s; silence means the connection died silently (the Vite
// proxy holds dead SSE streams open), so reconnect and let `open` refetch.
const WATCHDOG_MS = 15_000;

export function useLiveRefresh() {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(true);
  useEffect(() => {
    let source: EventSource;
    let watchdog: ReturnType<typeof setTimeout>;
    const connect = () => {
      source = new EventSource("/events");
      const expire = () => {
        setLive(false);
        source.close();
        connect();
      };
      const beat = () => {
        setLive(true);
        clearTimeout(watchdog);
        watchdog = setTimeout(expire, WATCHDOG_MS);
      };
      const refresh = () => {
        void queryClient.invalidateQueries();
        beat();
      };
      source.addEventListener("open", refresh);
      source.addEventListener("change", refresh);
      source.addEventListener("ping", beat);
      source.addEventListener("error", () => setLive(false));
      watchdog = setTimeout(expire, WATCHDOG_MS);
    };
    connect();
    return () => {
      clearTimeout(watchdog);
      source.close();
    };
  }, [queryClient]);
  return { live };
}
