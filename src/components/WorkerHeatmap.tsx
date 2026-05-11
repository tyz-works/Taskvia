"use client";

import type { Task, Worker } from "@/app/actions";

const ALL_SKILLS = [
  "ops", "bash", "code", "python", "typescript",
  "research", "database", "cloud", "docs", "review", "qa", "planning",
];

function cellColor(count: number, max: number): string {
  if (count === 0 || max === 0) return "bg-zinc-900 border-zinc-800";
  const ratio = count / max;
  if (ratio >= 0.8) return "bg-emerald-500/80 border-emerald-500/50 text-white";
  if (ratio >= 0.5) return "bg-emerald-500/50 border-emerald-500/40 text-emerald-200";
  if (ratio >= 0.25) return "bg-emerald-500/25 border-emerald-500/30 text-emerald-300";
  return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
}

export default function WorkerHeatmap({
  workers,
  tasks,
}: {
  workers: Worker[];
  tasks: Task[];
}) {
  if (workers.length === 0) {
    return (
      <div className="text-zinc-600 text-xs text-center py-12">
        Worker データがありません。
        <span className="block mt-1 text-zinc-700">plan.sh init で同期してください。</span>
      </div>
    );
  }

  // Collect skills that appear in either workers or tasks
  const skillSet = new Set<string>();
  for (const w of workers) w.skills.forEach((s) => skillSet.add(s));
  for (const t of tasks) t.skills.forEach((s) => skillSet.add(s));
  const skills = ALL_SKILLS.filter((s) => skillSet.has(s));

  // Build matrix: worker → skill → task count (assigned tasks with that skill)
  const matrix = new Map<string, Map<string, number>>();
  for (const w of workers) {
    const row = new Map<string, number>();
    for (const s of skills) row.set(s, 0);
    matrix.set(w.name, row);
  }
  for (const t of tasks) {
    if (!t.assignee) continue;
    const row = matrix.get(t.assignee);
    if (!row) continue;
    for (const s of t.skills) {
      if (row.has(s)) row.set(s, (row.get(s) ?? 0) + 1);
    }
  }

  // Also add registry task_count for workers' own skill columns (as background)
  // Max value for color scaling
  let maxVal = 0;
  for (const row of matrix.values()) {
    for (const v of row.values()) {
      if (v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) maxVal = 1;

  return (
    <div className="overflow-auto">
      <div
        className="inline-grid gap-px bg-zinc-800 rounded-xl overflow-hidden min-w-max"
        style={{ gridTemplateColumns: `auto repeat(${skills.length}, minmax(44px, 1fr))` }}
        role="table"
        aria-label="Worker skill heatmap"
      >
        {/* Header row */}
        <div className="bg-zinc-950 px-3 py-2 text-[10px] text-zinc-600 uppercase tracking-wider">
          Worker
        </div>
        {skills.map((s) => (
          <div
            key={s}
            className="bg-zinc-950 px-1 py-2 text-[9px] text-zinc-500 text-center font-medium uppercase tracking-wider"
            title={s}
          >
            {s}
          </div>
        ))}

        {/* Data rows */}
        {workers.map((w) => {
          const row = matrix.get(w.name)!;
          const isRegisteredSkill = (s: string) => w.skills.includes(s);

          return (
            <>
              {/* Worker name cell */}
              <div
                key={`name-${w.name}`}
                className="bg-zinc-950 px-3 py-2 flex items-center gap-1.5"
              >
                <span className="text-[11px] text-zinc-300 font-medium whitespace-nowrap">{w.name}</span>
                {w.role && (
                  <span className="text-[9px] px-1 py-px rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 leading-none">
                    {w.role}
                  </span>
                )}
                <span className="text-[10px] text-zinc-600 ml-auto">{w.task_count}</span>
              </div>

              {/* Skill cells */}
              {skills.map((s) => {
                const count = row.get(s) ?? 0;
                const registered = isRegisteredSkill(s);
                return (
                  <div
                    key={`${w.name}-${s}`}
                    className={`flex items-center justify-center text-[10px] font-bold border transition-colors ${cellColor(count, maxVal)} ${registered ? "ring-1 ring-inset ring-zinc-600/40" : ""}`}
                    title={`${w.name} × ${s}: ${count} task${count !== 1 ? "s" : ""}${registered ? " (registered skill)" : ""}`}
                    style={{ minHeight: "32px" }}
                  >
                    {count > 0 ? count : registered ? (
                      <span className="text-zinc-700 text-[8px]">✓</span>
                    ) : null}
                  </div>
                );
              })}
            </>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] text-zinc-600">
        セル数値 = このミッションでそのWorkerに割り当てられたタスク数。枠線あり = registryに登録済みスキル。
      </p>
    </div>
  );
}
