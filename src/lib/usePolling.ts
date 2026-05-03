"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
) {
  const fnRef = useRef(fn);
  // Update ref after each render so the interval always calls the latest fn
  // without restarting the interval itself.
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

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
