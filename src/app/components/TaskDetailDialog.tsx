"use client";

import { useState, useEffect } from "react";
import { fetchReworkHistory, type Task, type VerificationRecord, type ReworkCycle } from "../actions";
import {
  PRIORITY_BADGE,
  VERIFICATION_BADGE,
  verificationIcon,
  toVerificationStatus,
} from "./constants";

const STATUS_LABEL: Record<Task["status"], string> = {
  pending:     "Backlog",
  in_progress: "In Progress",
  done:        "Done",
  blocked:     "Blocked",
};

const STATUS_COLOR: Record<Task["status"], string> = {
  pending:     "bg-zinc-700 text-zinc-400 border-zinc-600",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  done:        "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  blocked:     "bg-red-500/20 text-red-400 border-red-500/30",
};

export function TaskDetailDialog({
  task,
  verificationRecord,
  verificationEnabled,
  onClose,
}: {
  task: Task;
  verificationRecord?: VerificationRecord;
  verificationEnabled: boolean;
  onClose: () => void;
}) {
  const [reworkHistory, setReworkHistory] = useState<ReworkCycle[]>([]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!verificationEnabled) return;
    fetchReworkHistory(task.id).then(setReworkHistory);
  }, [task.id, verificationEnabled]);

  const createdAt = new Date(task.created_at).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const vStatus = toVerificationStatus(verificationRecord);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={task.title}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wider">タスク詳細</p>
              <h2 className="text-white font-bold text-base mt-0.5 leading-snug">{task.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-zinc-500 hover:text-zinc-300 text-lg leading-none mt-0.5"
            >
              ✕
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_COLOR[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[task.priority]}`}>
              {task.priority}
            </span>
            <code className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{task.id}</code>
          </div>

          {verificationEnabled && (
            <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium ${VERIFICATION_BADGE[vStatus]}`}>
              <span aria-hidden="true">{verificationIcon(vStatus)}</span>
              <span>{vStatus}</span>
              {verificationRecord && verificationRecord.rework_count > 0 && (
                <span className="ml-auto text-[10px] opacity-70">rework: {verificationRecord.rework_count}</span>
              )}
              {verificationRecord?.verifier && (
                <span className="ml-auto text-[10px] opacity-60">by {verificationRecord.verifier}</span>
              )}
            </div>
          )}

          <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">担当</div>
            <div className="text-sm text-zinc-200">
              {task.assignee ?? <span className="text-zinc-600 italic">未割り当て</span>}
            </div>
          </div>

          {task.skills.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">スキル</div>
              <div className="flex flex-wrap gap-1">
                {task.skills.map((s) => (
                  <span key={s} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {task.blocked_by.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1">
              <div className="text-[10px] text-red-400 uppercase tracking-wider">ブロック依存</div>
              <div className="flex flex-wrap gap-1">
                {task.blocked_by.map((dep) => (
                  <code key={dep} className="text-[11px] text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded">
                    {dep}
                  </code>
                ))}
              </div>
            </div>
          )}

          {verificationEnabled && reworkHistory.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Rework 履歴</div>
              <div className="space-y-1.5 max-h-[15lh] overflow-y-auto">
                {reworkHistory.slice(0, 15).map((cycle) => (
                  <ReworkCycleRow key={cycle.cycle} cycle={cycle} />
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-zinc-600 text-right">{createdAt}</div>
        </div>
      </div>
    </div>
  );
}

function ReworkCycleRow({ cycle }: { cycle: ReworkCycle }) {
  return (
    <div
      className={`rounded-lg border p-2.5 text-[11px] space-y-1 ${
        cycle.verdict === "pass"
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-red-500/20 bg-red-500/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={cycle.verdict === "pass" ? "text-emerald-400" : "text-red-400"}>
          {cycle.verdict === "pass" ? "✓" : "✗"} cycle {cycle.cycle}
        </span>
        {cycle.verified_at && (
          <span className="text-zinc-600 text-[10px] ml-auto">
            {new Date(cycle.verified_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {cycle.failed_checks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cycle.failed_checks.map((c, i) => (
            <code key={i} className="text-[10px] text-red-300 bg-red-500/10 px-1 py-0.5 rounded">
              {c.name}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
