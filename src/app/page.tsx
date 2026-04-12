"use client";

import { useState, useEffect, useCallback } from "react";
import { submitRequest, fetchRequests as fetchRequestsAction, approveCard, denyCard } from "./actions";

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

interface MissionRequest {
  id: string;
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  skills: string[];
  target_dir: string;
  deadline_note: string;
  status: "pending" | "processing" | "done" | "rejected";
  created_at: string;
  processed_at: string | null;
}

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-zinc-700 text-zinc-400 border-zinc-600",
};

const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  done: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

const ALL_SKILLS = [
  "ops", "bash", "code", "python", "typescript",
  "research", "database", "cloud", "docs", "review",
];

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

function RequestFormModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [skills, setSkills] = useState<string[]>([]);
  const [targetDir, setTargetDir] = useState("");
  const [deadlineNote, setDeadlineNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSkill = (skill: string) => {
    setSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    if (!body.trim()) { setError("依頼内容を入力してください"); return; }

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitRequest({
        title: title.trim(),
        body: body.trim(),
        priority,
        skills,
        target_dir: targetDir.trim(),
        deadline_note: deadlineNote.trim(),
      });

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onSubmitted(result.id);
    } catch {
      setError("ネットワークエラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-white font-semibold text-base">Orchestrator に依頼</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
          </div>

          {/* Title */}
          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">
              タイトル <span className="text-red-400">*</span>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: ログビューアにフィルタ機能を追加"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>

          {/* Body */}
          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">
              依頼内容 <span className="text-red-400">*</span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="詳細な依頼内容を記載してください"
              rows={4}
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600 resize-none"
            />
          </div>

          {/* Priority */}
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">優先度</div>
            <div className="flex gap-2">
              {(["high", "medium", "low"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    priority === p
                      ? PRIORITY_BADGE[p]
                      : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Skills */}
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">スキル</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SKILLS.map((skill) => (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                    skills.includes(skill)
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>

          {/* Target Dir */}
          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">target_dir（任意）</div>
            <input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder="/Users/tyz/workspace/..."
              className="w-full bg-transparent text-sm text-zinc-400 outline-none placeholder:text-zinc-600 font-mono"
            />
          </div>

          {/* Deadline Note */}
          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">締切メモ（任意）</div>
            <input
              value={deadlineNote}
              onChange={(e) => setDeadlineNote(e.target.value)}
              placeholder="例: 今週中に"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onClose}
              className="py-3 rounded-xl bg-zinc-700/50 border border-zinc-600 text-zinc-400 font-semibold hover:bg-zinc-700 active:scale-95 transition-all"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "送信中..." : "依頼を送信"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm px-4 py-2.5 rounded-xl shadow-2xl animate-fade-in">
      {message}
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
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [requests, setRequests] = useState<MissionRequest[]>([]);
  const [showRequests, setShowRequests] = useState(false);

  const fetchCards = useCallback(async () => {
    const res = await fetch("/api/cards");
    if (res.ok) {
      const data = await res.json();
      setCards(data.cards);
    }
    setLoading(false);
  }, []);

  const fetchRequests = useCallback(async () => {
    const data = await fetchRequestsAction();
    setRequests(data);
  }, []);

  useEffect(() => {
    fetchCards();
    fetchRequests();
    const t = setInterval(() => {
      fetchCards();
      fetchRequests();
    }, 3000);
    return () => clearInterval(t);
  }, [fetchCards, fetchRequests]);

  const handleApprove = async (id: string) => {
    await approveCard(id);
    setSelected(null);
    await fetchCards();
  };

  const handleDeny = async (id: string) => {
    await denyCard(id);
    setSelected(null);
    await fetchCards();
  };

  const handleSubmitted = useCallback((id: string) => {
    setShowRequestForm(false);
    setToast(`リクエスト #${id} を送信しました`);
    fetchRequests();
  }, [fetchRequests]);

  const pending = cards.filter((c) => c.status === "pending");
  const pendingRequests = requests.filter((r) => r.status === "pending");

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-base tracking-tight">Taskvia</h1>
          <p className="text-[11px] text-zinc-500">Agent Approval Board</p>
        </div>
        <div className="flex items-center gap-3">
          {pending.length > 0 && (
            <span className="bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {pending.length}
            </span>
          )}
          <div className={`w-2 h-2 rounded-full ${loading ? "bg-zinc-600" : "bg-emerald-400"}`} />
          <button
            onClick={() => setShowRequestForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 active:scale-95 transition-all"
          >
            <span>＋</span>
            <span>Orchestrator に依頼</span>
          </button>
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

      {/* Requests Section */}
      {requests.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <button
            onClick={() => setShowRequests((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <div className={`w-2 h-2 rounded-full ${pendingRequests.length > 0 ? "bg-yellow-400" : "bg-zinc-500"}`} />
            <span>送信済みリクエスト</span>
            <span className="text-zinc-600">{requests.length}</span>
            <span className="ml-auto text-zinc-600">{showRequests ? "▲" : "▼"}</span>
          </button>

          {showRequests && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-100 text-xs font-medium truncate flex-1">{req.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${REQUEST_STATUS_STYLE[req.status]}`}>
                      {req.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[req.priority]}`}>
                      {req.priority}
                    </span>
                    {req.skills.length > 0 && (
                      <span className="text-[10px] text-zinc-500 truncate">
                        {req.skills.join(", ")}
                      </span>
                    )}
                  </div>
                  {req.deadline_note && (
                    <div className="text-[10px] text-zinc-600">{req.deadline_note}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Approval Modal */}
      {selected && (
        <ApprovalModal
          card={selected}
          onApprove={() => handleApprove(selected.id)}
          onDeny={() => handleDeny(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Request Form Modal */}
      {showRequestForm && (
        <RequestFormModal
          onClose={() => setShowRequestForm(false)}
          onSubmitted={handleSubmitted}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
