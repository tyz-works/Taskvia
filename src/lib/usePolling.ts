"use client";

import { useEffect, useRef } from "react";

export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
) {
  // Keep a stable ref so interval callback always calls the latest fn
  // without needing fn in the dependency array (avoids restart on every render)
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      void fnRef.current();
      timer = setInterval(() => void fnRef.current(), intervalMs);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
