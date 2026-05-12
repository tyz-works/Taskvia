"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/app/actions";

const BAR_COLOR: Record<Task["status"], string> = {
  pending:     "#52525b",
  blocked:     "#ef4444",
  in_progress: "#3b82f6",
  done:        "#10b981",
};

const ROW_H = 28;
const LABEL_W = 120;
const AXIS_H = 24;
const PADDING = 8;

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MissionTimeline({ tasks }: { tasks: Task[] }) {
  const [now, setNow] = useState<number>(0);
  useEffect(() => { setNow(Date.now()); }, []);

  if (tasks.length === 0) {
    return (
      <div className="text-zinc-600 text-xs text-center py-12">
        タスクがありません
      </div>
    );
  }

  if (now === 0) return null;

  // Compute time range
  const times = tasks.flatMap((t) => {
    const pts: number[] = [new Date(t.created_at).getTime()];
    if (t.started_at) pts.push(new Date(t.started_at).getTime());
    if (t.completed_at) pts.push(new Date(t.completed_at).getTime());
    return pts;
  });
  const tMin = Math.min(...times);
  const tMax = Math.max(Math.max(...times), now);
  const tSpan = tMax - tMin || 1;

  const chartW = 600;
  const svgW = LABEL_W + chartW + PADDING * 2;
  const svgH = AXIS_H + tasks.length * ROW_H + PADDING;

  const toX = (t: number) => LABEL_W + ((t - tMin) / tSpan) * chartW;

  // Axis ticks (5 ticks)
  const ticks = Array.from({ length: 5 }, (_, i) => tMin + (tSpan * i) / 4);

  return (
    <div className="overflow-x-auto">
      <svg
        width={svgW}
        height={svgH}
        className="font-mono select-none"
        aria-label="Mission timeline Gantt chart"
      >
        {/* Axis */}
        <line
          x1={LABEL_W}
          y1={AXIS_H}
          x2={LABEL_W + chartW}
          y2={AXIS_H}
          stroke="#3f3f46"
          strokeWidth={1}
        />
        {ticks.map((t, i) => {
          const x = toX(t);
          return (
            <g key={i}>
              <line x1={x} y1={AXIS_H - 4} x2={x} y2={AXIS_H} stroke="#3f3f46" strokeWidth={1} />
              <text
                x={x}
                y={AXIS_H - 6}
                textAnchor="middle"
                fontSize={8}
                fill="#71717a"
              >
                {fmt(new Date(t).toISOString())}
              </text>
            </g>
          );
        })}

        {/* "Now" marker */}
        {now <= tMax && (
          <line
            x1={toX(now)}
            y1={AXIS_H}
            x2={toX(now)}
            y2={svgH - PADDING}
            stroke="#fbbf24"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}

        {/* Rows */}
        {tasks.map((task, i) => {
          const y = AXIS_H + i * ROW_H;
          const midY = y + ROW_H / 2;
          const color = BAR_COLOR[task.status];

          const createdX = toX(new Date(task.created_at).getTime());
          const startX = task.started_at
            ? toX(new Date(task.started_at).getTime())
            : null;
          const endX = task.completed_at
            ? toX(new Date(task.completed_at).getTime())
            : null;

          return (
            <g key={task.id}>
              {/* Row stripe */}
              {i % 2 === 0 && (
                <rect
                  x={LABEL_W}
                  y={y}
                  width={chartW}
                  height={ROW_H}
                  fill="#18181b"
                />
              )}

              {/* Label */}
              <text
                x={LABEL_W - 6}
                y={midY + 4}
                textAnchor="end"
                fontSize={9}
                fill="#a1a1aa"
                className="truncate"
              >
                {task.id}
              </text>

              {/* Queued bar: created → started (gray) */}
              {startX !== null && (
                <rect
                  x={createdX}
                  y={midY - 4}
                  width={Math.max(startX - createdX, 2)}
                  height={8}
                  fill="#3f3f46"
                  rx={2}
                >
                  <title>{`queued: ${fmt(task.created_at)} → ${fmt(task.started_at!)}`}</title>
                </rect>
              )}

              {/* Active bar: started → completed/now */}
              {startX !== null && (
                <rect
                  x={startX}
                  y={midY - 5}
                  width={Math.max((endX ?? toX(now)) - startX, 2)}
                  height={10}
                  fill={color}
                  rx={2}
                  opacity={task.status === "in_progress" ? 0.85 : 1}
                >
                  <title>
                    {`${task.title} (${task.status})\n${fmt(task.started_at!)} → ${task.completed_at ? fmt(task.completed_at) : "now"}`}
                  </title>
                </rect>
              )}

              {/* No started_at: show pending dot at created */}
              {startX === null && (
                <circle
                  cx={createdX}
                  cy={midY}
                  r={3}
                  fill={color}
                  opacity={0.7}
                >
                  <title>{`${task.title} (${task.status}) — not started`}</title>
                </circle>
              )}

              {/* Task title inline (if space) */}
              {startX !== null && (endX ?? toX(now)) - startX > 30 && (
                <text
                  x={startX + 4}
                  y={midY + 3}
                  fontSize={8}
                  fill="white"
                  opacity={0.8}
                  clipPath={`url(#clip-${i})`}
                >
                  {task.title}
                </text>
              )}
              <clipPath id={`clip-${i}`}>
                <rect
                  x={startX ?? createdX}
                  y={midY - 5}
                  width={(endX ?? toX(now)) - (startX ?? createdX)}
                  height={10}
                />
              </clipPath>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
