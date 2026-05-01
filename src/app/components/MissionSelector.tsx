"use client";

import { type Mission } from "../actions";

export function MissionSelector({
  missions,
  selected,
  onChange,
}: {
  missions: Mission[];
  selected: string | null;
  onChange: (slug: string | null) => void;
}) {
  const activeMissions = missions.filter((m) => m.status !== "done");
  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-zinc-500 transition-colors max-w-[200px] truncate"
    >
      <option value="">All missions</option>
      {activeMissions.map((m) => (
        <option key={m.slug} value={m.slug}>
          {m.title}
        </option>
      ))}
    </select>
  );
}
