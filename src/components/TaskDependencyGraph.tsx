"use client";

import { useState } from "react";
import type { Task } from "@/app/actions";

const NODE_W = 110;
const NODE_H = 36;
const COL_GAP = 80;
const ROW_GAP = 16;
const PAD = 16;

const STATUS_FILL: Record<Task["status"], string> = {
  pending:     "#27272a",
  blocked:     "#450a0a",
  in_progress: "#1e3a5f",
  done:        "#052e16",
};

const STATUS_STROKE: Record<Task["status"], string> = {
  pending:     "#52525b",
  blocked:     "#ef4444",
  in_progress: "#3b82f6",
  done:        "#10b981",
};

const STATUS_TEXT: Record<Task["status"], string> = {
  pending:     "#a1a1aa",
  blocked:     "#fca5a5",
  in_progress: "#93c5fd",
  done:        "#6ee7b7",
};

function topoLayers(tasks: Task[]): Map<string, number> {
  const layers = new Map<string, number>();
  const inDeg = new Map<string, number>();
  const taskIds = new Set(tasks.map((t) => t.id));

  for (const t of tasks) {
    // Only count blockers that exist in this task set
    const blockers = t.blocked_by.filter((b) => taskIds.has(b));
    inDeg.set(t.id, blockers.length);
  }

  // Kahn's algorithm
  const queue = tasks.filter((t) => (inDeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  for (const id of queue) layers.set(id, 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layers.get(cur) ?? 0;
    for (const t of tasks) {
      if (!t.blocked_by.includes(cur)) continue;
      const newLayer = curLayer + 1;
      if (!layers.has(t.id) || layers.get(t.id)! < newLayer) {
        layers.set(t.id, newLayer);
      }
      const deg = (inDeg.get(t.id) ?? 1) - 1;
      inDeg.set(t.id, deg);
      if (deg === 0) queue.push(t.id);
    }
  }

  // Fallback for any remaining (cycles / disconnected)
  for (const t of tasks) {
    if (!layers.has(t.id)) layers.set(t.id, 0);
  }

  return layers;
}

interface NodePos {
  x: number;
  y: number;
  task: Task;
}

export default function TaskDependencyGraph({ tasks }: { tasks: Task[] }) {
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  if (tasks.length === 0) {
    return (
      <div className="text-zinc-600 text-xs text-center py-12">タスクがありません</div>
    );
  }

  const layers = topoLayers(tasks);
  const maxLayer = Math.max(...Array.from(layers.values()));

  // Group tasks by layer, sort for stable layout
  const byLayer: Task[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const t of tasks) {
    byLayer[layers.get(t.id) ?? 0].push(t);
  }

  // Compute node positions
  const positions = new Map<string, NodePos>();
  for (let col = 0; col <= maxLayer; col++) {
    const colTasks = byLayer[col];
    const colH = colTasks.length * (NODE_H + ROW_GAP) - ROW_GAP;
    colTasks.forEach((t, row) => {
      const x = PAD + col * (NODE_W + COL_GAP);
      const y = PAD + row * (NODE_H + ROW_GAP);
      positions.set(t.id, { x, y, task: t });
    });
    void colH; // suppress unused warning
  }

  const svgW = PAD * 2 + (maxLayer + 1) * (NODE_W + COL_GAP) - COL_GAP;
  const maxRowCount = Math.max(...byLayer.map((col) => col.length));
  const svgH = PAD * 2 + maxRowCount * (NODE_H + ROW_GAP) - ROW_GAP;

  // Edges: for each blocked_by relationship, draw arrow blocker→dependent
  const edges: { x1: number; y1: number; x2: number; y2: number; status: Task["status"] }[] = [];
  for (const t of tasks) {
    const dest = positions.get(t.id);
    if (!dest) continue;
    for (const blockerId of t.blocked_by) {
      const src = positions.get(blockerId);
      if (!src) continue;
      const srcTask = src.task;
      edges.push({
        x1: src.x + NODE_W,
        y1: src.y + NODE_H / 2,
        x2: dest.x,
        y2: dest.y + NODE_H / 2,
        status: srcTask.status,
      });
    }
  }

  const activeTooltip = tooltip ? tasks.find((t) => t.id === tooltip.id) : null;

  return (
    <div className="overflow-auto relative">
      <svg
        width={svgW}
        height={svgH}
        aria-label="Task dependency DAG"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Arrow marker defs */}
        <defs>
          {(["pending", "blocked", "in_progress", "done"] as Task["status"][]).map((s) => (
            <marker
              key={s}
              id={`arrow-${s}`}
              markerWidth={6}
              markerHeight={6}
              refX={5}
              refY={3}
              orient="auto"
            >
              <path d="M0,0 L0,6 L6,3 z" fill={STATUS_STROKE[s]} />
            </marker>
          ))}
        </defs>

        {/* Edges */}
        {edges.map((e, i) => {
          const midX = (e.x1 + e.x2) / 2;
          return (
            <path
              key={i}
              d={`M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`}
              stroke={STATUS_STROKE[e.status]}
              strokeWidth={1.5}
              fill="none"
              opacity={0.5}
              markerEnd={`url(#arrow-${e.status})`}
            />
          );
        })}

        {/* Nodes */}
        {Array.from(positions.values()).map(({ x, y, task }) => (
          <g
            key={task.id}
            onMouseEnter={(ev) => {
              const rect = (ev.currentTarget as SVGElement).closest("svg")!.getBoundingClientRect();
              setTooltip({ id: task.id, x: ev.clientX - rect.left, y: ev.clientY - rect.top });
            }}
            onMouseLeave={() => setTooltip(null)}
            style={{ cursor: "default" }}
          >
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={6}
              fill={STATUS_FILL[task.status]}
              stroke={STATUS_STROKE[task.status]}
              strokeWidth={1.5}
            />
            <text
              x={x + NODE_W / 2}
              y={y + 13}
              textAnchor="middle"
              fontSize={9}
              fill={STATUS_TEXT[task.status]}
              fontWeight="bold"
            >
              {task.id}
            </text>
            <text
              x={x + 6}
              y={y + 26}
              fontSize={8}
              fill={STATUS_TEXT[task.status]}
              opacity={0.85}
            >
              <tspan>{task.title.length > 14 ? task.title.slice(0, 14) + "…" : task.title}</tspan>
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {activeTooltip && tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-2 text-[11px] shadow-xl max-w-[200px]"
          style={{ left: tooltip.x + 8, top: tooltip.y - 10 }}
        >
          <p className="text-zinc-200 font-medium leading-snug">{activeTooltip.title}</p>
          <p className="text-zinc-500 mt-0.5">
            <code className="text-zinc-400">{activeTooltip.id}</code>
            {" · "}
            <span className="capitalize">{activeTooltip.status.replace("_", " ")}</span>
          </p>
          {activeTooltip.assignee && (
            <p className="text-zinc-500 mt-0.5">→ {activeTooltip.assignee}</p>
          )}
          {activeTooltip.blocked_by.length > 0 && (
            <p className="text-zinc-500 mt-0.5">
              blocked by: {activeTooltip.blocked_by.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
