"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { Mission, Task } from "@/app/actions";
import { fetchMissionTasks } from "@/app/actions";
import { usePolling } from "@/lib/usePolling";
import MissionTimeline from "./MissionTimeline";
import TaskDependencyGraph from "./TaskDependencyGraph";
import WorkerHeatmap from "./WorkerHeatmap";
import type { Worker } from "@/app/actions";

const POLL_MS = 5000;

type DetailTab = "timeline" | "dag" | "heatmap";

const STATUS_COLOR: Record<Task["status"], string> = {
  pending:     "bg-zinc-700 text-zinc-400 border-zinc-600",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  done:        "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  blocked:     "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  pending:     "Pending",
  in_progress: "In Progress",
  done:        "Done",
  blocked:     "Blocked",
};

const MISSION_STATUS_COLOR: Record<string, string> = {
  in_progress: "text-blue-400",
  done:        "text-emerald-400",
  ready:       "text-yellow-400",
};

export default function MissionDetail({
  mission,
  initialTasks,
  workers,
}: {
  mission: Mission;
  initialTasks: Task[];
  workers: Worker[];
}) {
  const [tab, setTab] = useState<DetailTab>("timeline");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  const refresh = useCallback(async () => {
    const latest = await fetchMissionTasks(mission.slug);
    setTasks(latest);
  }, [mission.slug]);

  usePolling(refresh, POLL_MS);

  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Link
          href="/"
          className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors shrink-0"
          aria-label="ダッシュボードに戻る"
        >
          ← Board
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-base truncate">{mission.title}</h1>
          <p className="text-[11px] text-zinc-500">
            <span className={MISSION_STATUS_COLOR[mission.status] ?? "text-zinc-400"}>
              {mission.status}
            </span>
            <span className="mx-1.5 text-zinc-700">·</span>
            <code className="text-zinc-600">{mission.slug}</code>
            <span className="mx-1.5 text-zinc-700">·</span>
            <span className="text-zinc-600">{done}/{total} tasks done</span>
          </p>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="border-b border-zinc-800 px-4 flex gap-1">
        {(["timeline", "dag", "heatmap"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              tab === key
                ? "text-white border-b-2 border-emerald-400"
                : "text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent"
            }`}
          >
            {key === "timeline" ? "Timeline" : key === "dag" ? "DAG" : "Heatmap"}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="p-4">
        {tab === "timeline" && (
          <MissionTimeline tasks={tasks} />
        )}
        {tab === "dag" && (
          <TaskDependencyGraph tasks={tasks} />
        )}
        {tab === "heatmap" && (
          <WorkerHeatmap workers={workers} tasks={tasks} />
        )}
      </div>

      {/* Task list summary */}
      <div className="px-4 pb-8 space-y-2">
        <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider mb-3">Tasks</h2>
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
          >
            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_COLOR[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            <code className="text-[10px] text-zinc-600 shrink-0">{task.id}</code>
            <span className="text-sm text-zinc-200 truncate flex-1">{task.title}</span>
            {task.assignee && (
              <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded shrink-0">
                {task.assignee}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
