"use client";

import { type Task, type ApprovalCard, type VerificationRecord } from "../actions";
import {
  PRIORITY_BADGE,
  VERIFICATION_BADGE,
  verificationIcon,
  toVerificationStatus,
} from "./constants";

export function TaskCard({
  task,
  pendingApprovals,
  verificationRecord,
  verificationEnabled,
  onApprovalBadgeClick,
  onDelete,
  onCardClick,
}: {
  task: Task;
  pendingApprovals: ApprovalCard[];
  verificationRecord?: VerificationRecord;
  verificationEnabled: boolean;
  onApprovalBadgeClick: (card: ApprovalCard) => void;
  onDelete?: () => void;
  onCardClick: (task: Task) => void;
}) {
  const count = pendingApprovals.length;
  const vStatus = toVerificationStatus(verificationRecord);

  return (
    <div
      className="rounded-xl border border-zinc-700/60 bg-zinc-900 p-3 space-y-2 text-sm cursor-pointer hover:border-zinc-600 hover:bg-zinc-900/80 active:scale-[0.98] transition-all"
      onClick={() => onCardClick(task)}
    >
      <div className="flex items-start gap-2">
        <span className="text-zinc-100 text-xs font-medium leading-snug flex-1 line-clamp-2">{task.title}</span>
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[task.priority]}`}>
          {task.priority}
        </span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="タスクを削除"
            className="shrink-0 text-zinc-700 hover:text-red-400 text-xs leading-none transition-colors"
          >
            ×
          </button>
        )}
      </div>

      {count > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onApprovalBadgeClick(pendingApprovals[0]); }}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium hover:bg-amber-500/20 active:scale-95 transition-all w-full"
        >
          <span>⚠️</span>
          <span>承認 {count}件</span>
        </button>
      )}

      {verificationEnabled && vStatus !== "pending" && (
        <div
          role="status"
          aria-label={`verification ${vStatus}${verificationRecord && verificationRecord.rework_count > 0 ? `, rework ${verificationRecord.rework_count} of ${verificationRecord.max_rework ?? 3}` : ""}`}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg border font-medium ${VERIFICATION_BADGE[vStatus]}`}
        >
          <span aria-hidden="true">{verificationIcon(vStatus)}</span>
          <span>{vStatus}</span>
          {verificationRecord && verificationRecord.rework_count > 0 && (
            <span className="ml-auto opacity-70">rework: {verificationRecord.rework_count}/{verificationRecord.max_rework ?? 3}</span>
          )}
        </div>
      )}

      {task.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.skills.map((s) => (
            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-zinc-600">
        <code>{task.id}</code>
        {task.assignee ? (
          <span className="text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">{task.assignee}</span>
        ) : (
          <span className="text-zinc-700 italic">unassigned</span>
        )}
      </div>
    </div>
  );
}
