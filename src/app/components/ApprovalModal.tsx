"use client";

import { useState } from "react";
import { approveCard, denyCard, deleteCard, type ApprovalCard } from "../actions";
import { PRIORITY_BADGE } from "./constants";

export function ApprovalModal({
  card,
  onClose,
  onDone,
  onDeleted,
  remainingCount,
}: {
  card: ApprovalCard;
  onClose: () => void;
  onDone: (action: "approved" | "denied") => void;
  onDeleted?: () => void;
  remainingCount: number;
}) {
  const [acting, setActing] = useState(false);

  const handle = async (action: "approve" | "deny") => {
    setActing(true);
    try {
      if (action === "approve") {
        await approveCard(card.id);
      } else {
        await denyCard(card.id);
      }
      onDone(action === "approve" ? "approved" : "denied");
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("このカードを削除しますか？")) return;
    setActing(true);
    try {
      await deleteCard(card.id);
      onDeleted?.();
    } finally {
      setActing(false);
    }
  };

  const timeAgo = (() => {
    const diff = Math.floor((Date.now() - new Date(card.created_at).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-zinc-500 text-[10px] uppercase tracking-wider">承認リクエスト</p>
              <h2 className="text-white font-bold text-2xl mt-0.5 leading-tight">{card.agent}</h2>
              <p className="text-zinc-500 text-xs mt-0.5">{timeAgo}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={acting}
                title="カードを削除"
                className="text-zinc-600 hover:text-red-400 text-sm leading-none transition-colors disabled:opacity-30"
              >
                🗑
              </button>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none mt-0.5">✕</button>
            </div>
          </div>

          <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Tool</div>
            <code className="text-sm text-emerald-300 break-all">{card.tool}</code>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-violet-500/20 text-violet-400 border-violet-500/30">
              {card.project}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[card.priority] ?? PRIORITY_BADGE.medium}`}>
              {card.priority}
            </span>
            {card.task_id && (
              <code className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{card.task_id}</code>
            )}
          </div>

          {remainingCount > 0 && (
            <p className="text-center text-zinc-500 text-xs">あと {remainingCount} 件</p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={() => handle("deny")}
              disabled={acting}
              className="py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-semibold hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => handle("approve")}
              disabled={acting}
              className="py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {acting ? "…" : "Approve"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
