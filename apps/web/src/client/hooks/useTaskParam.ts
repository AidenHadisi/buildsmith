import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getSnapshot() {
  return new URLSearchParams(location.search).get("task");
}

export function useTaskParam(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, getSnapshot);
  const setTaskId = (next: string | null) => {
    const params = new URLSearchParams(location.search);
    if (next === null) params.delete("task");
    else params.set("task", next);
    const search = params.toString();
    history.pushState(null, "", search ? `?${search}` : location.pathname);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return [id, setTaskId];
}
