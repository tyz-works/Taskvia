"use client";

import { useEffect } from "react";

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm px-4 py-2.5 rounded-xl shadow-2xl">
      {message}
    </div>
  );
}
