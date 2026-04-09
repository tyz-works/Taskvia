"use client";

import { useState, useEffect, useCallback } from "react";

interface Card {
  id: string;
  tool: string;
  agent: string;
  task_title: string;
  task_id: string | null;
  priority: "high" | "medium" | "low";
  status: "pending" | "approved" | "denied";
  created_at: string;
}

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-zinc-700 text-zinc-400 border-zinc-600",
};

function ttlSeconds(createdAt: string) {
  return Math.max(0, 600 - Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
}

function CardItem({ card, onClick }: { card: Card; onClick?: () => void }) {
  const [ttl, setTtl] = useState(ttlSeconds(card.created_at));

  useEffect(() => {
    if (card.status !== "pending") return;
    const t = setInterval(() => setTtl(ttlSeconds(card.created_at)), 1000);
    return () => clearInterval(t);
  }, [card]);

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-3 text-sm space-y-1.5 ${
        card.status === "pending"
          ? "border-yellow-500/40 bg-yellow-500/5 cursor-pointer hover:bg-yellow-500/10 active:scale-[0.98]"
          : card.status === "approved"
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-zinc-700 bg-zinc-800/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <code className="text-xs text-zinc-300 truncate flex-1">{card.tool}</code>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[card.priority]}`}>
          {card.priority}
        </span>
      </div>
      <div className="text-zinc-500 text-xs truncate">{card.task_title}</div>
      <div className="flex items-center justify-between text-[11px] text-zinc-600">
        <span>{card.agent}</span>
        {card.status === "pending" && (
          <span className={ttl < 60 ? "text-red-400" : "text-zinc-500"}>
            {String(Math.floor(ttl / 60)).padStart(2, "0")}:{String(ttl % 60).padStart(2, "0")}
          </span>
        )}
      </div>
    </div>
  );
}

function ApprovalModal({
  card,
  onApprove,
  onDeny,
  onClose,
}: {
  card: Card;
  onApprove: () => void;
  onDeny: () => void;
  onClose: () => void;
}) {
  const [ttl, setTtl] = useState(ttlSeconds(card.created_at));
  const pct = (ttl / 600) * 100;

  useEffect(() => {
    const t = setInterval(() => setTtl(ttlSeconds(card.created_at)), 1000);
    return () => clearInterval(t);
  }, [card]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
        {/* TTL progress bar */}
        <div className="h-1 bg-zinc-800">
          <div
            className={`h-full transition-all duration-1000 ${ttl < 60 ? "bg-red-500" : "bg-yellow-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-white font-semibold text-base leading-snug">承認リクエスト</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
          </div>

          <div className="space-y-2">
            <div className="bg-zinc-800 rounded-lg px-3 py-2">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Tool</div>
              <code className="text-sm text-zinc-100 break-all">{card.tool}</code>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-800 rounded-lg px-3 py-2">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Agent</div>
                <div className="text-sm text-zinc-200 truncate">{card.agent}</div>
              </div>
              <div className="bg-zinc-800 rounded-lg px-3 py-2">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Priority</div>
                <div className={`text-sm font-medium ${card.priority === "high" ? "text-red-400" : card.priority === "medium" ? "text-yellow-400" : "text-zinc-400"}`}>
                  {card.priority}
                </div>
              </div>
            </div>
            <div className="bg-zinc-800 rounded-lg px-3 py-2">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Task</div>
              <div className="text-sm text-zinc-200">{card.task_title}</div>
            </div>
          </div>

          <div className="text-center text-zinc-500 text-xs">
            タイムアウトまで {String(Math.floor(ttl / 60)).padStart(2, "0")}:{String(ttl % 60).padStart(2, "0")}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onDeny}
              className="py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-semibold hover:bg-red-500/20 active:scale-95 transition-all"
            >
              Deny
            </button>
            <button
              onClick={onApprove}
              className="py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const COLUMNS = [
  { status: "denied",  label: "Backlog",           color: "text-zinc-400",   dot: "bg-zinc-500" },
  { status: "pending", label: "Awaiting Approval",  color: "text-yellow-400", dot: "bg-yellow-400" },
  { status: "approved",label: "Done",               color: "text-emerald-400",dot: "bg-emerald-400" },
];

export default function KanbanPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCards = useCallback(async () => {
    const res = await fetch("/api/cards");
    if (res.ok) {
      const data = await res.json();
      setCards(data.cards);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCards();
    const t = setInterval(fetchCards, 3000);
    return () => clearInterval(t);
  }, [fetchCards]);

  const handleApprove = async (id: string) => {
    await fetch(`/api/approve/${id}`, { method: "POST" });
    setSelected(null);
    await fetchCards();
  };

  const handleDeny = async (id: string) => {
    await fetch(`/api/deny/${id}`, { method: "POST" });
    setSelected(null);
    await fetchCards();
  };

  const pending = cards.filter((c) => c.status === "pending");

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-base tracking-tight">Taskvia</h1>
          <p className="text-[11px] text-zinc-500">Agent Approval Board</p>
        </div>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <span className="bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {pending.length}
            </span>
          )}
          <div className={`w-2 h-2 rounded-full ${loading ? "bg-zinc-600" : "bg-emerald-400"}`} />
        </div>
      </header>

      {/* Columns */}
      <div className="grid grid-cols-3 gap-px bg-zinc-800 min-h-[calc(100vh-57px)]">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.status === col.status);
          return (
            <div key={col.status} className="bg-zinc-950 p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-3">
                <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${col.color}`}>
                  {col.label}
                </span>
                <span className="text-[11px] text-zinc-600 ml-auto">{colCards.length}</span>
              </div>
              {colCards.length === 0 ? (
                <div className="text-zinc-700 text-xs text-center py-6">—</div>
              ) : (
                colCards.map((card) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    onClick={col.status === "pending" ? () => setSelected(card) : undefined}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* Approval Modal */}
      {selected && (
        <ApprovalModal
          card={selected}
          onApprove={() => handleApprove(selected.id)}
          onDeny={() => handleDeny(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
