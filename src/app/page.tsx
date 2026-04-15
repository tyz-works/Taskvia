"use client";

import { useState, useEffect, useCallback } from "react";
import {
  submitRequest,
  fetchRequests as fetchRequestsAction,
  fetchMissions,
  fetchMissionTasks,
  fetchApprovalCards,
  fetchAgents,
  approveCard,
  denyCard,
  deleteCard,
  cleanupOrphanCards,
  deleteMissionTask,
  deleteMission,
  type Mission,
  type Task,
  type ApprovalCard,
  type AgentStatus,
} from "./actions";
import type { MissionRequest } from "./api/requests/route";

// Smart Polling intervals (ms)
const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 20000;

interface LogEntry {
  type: "knowledge" | "improvement" | "work";
  content: string;
  task_title: string;
  task_id: string | null;
  agent: string;
  timestamp: string;
}

type Tab = "board" | "logs";

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-zinc-700 text-zinc-400 border-zinc-600",
};

const TASK_COLUMNS: { status: Task["status"]; label: string; color: string; dot: string }[] = [
  { status: "blocked",     label: "Blocked",     color: "text-red-400",     dot: "bg-red-500" },
  { status: "pending",     label: "Backlog",      color: "text-zinc-400",    dot: "bg-zinc-500" },
  { status: "in_progress", label: "In Progress",  color: "text-blue-400",    dot: "bg-blue-400" },
  { status: "done",        label: "Done",         color: "text-emerald-400", dot: "bg-emerald-400" },
];

const ALL_SKILLS = [
  "ops", "bash", "code", "python", "typescript",
  "research", "database", "cloud", "docs", "review",
];

const LOG_TYPE_ICON: Record<LogEntry["type"], string> = {
  knowledge: "💡",
  improvement: "🔧",
  work: "📝",
};

const LOG_TYPE_COLOR: Record<LogEntry["type"], string> = {
  knowledge: "border-sky-500/30 bg-sky-500/5",
  improvement: "border-amber-500/30 bg-amber-500/5",
  work: "border-zinc-700 bg-zinc-800/50",
};

// ─── ApprovalModal ─────────────────────────────────────────────────────────

function ApprovalModal({
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

// ─── TaskDetailDialog ──────────────────────────────────────────────────────

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

function TaskDetailDialog({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const createdAt = new Date(task.created_at).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

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
          {/* Header */}
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

          {/* Status + Priority */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_COLOR[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[task.priority]}`}>
              {task.priority}
            </span>
            <code className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{task.id}</code>
          </div>

          {/* Assignee */}
          <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">担当</div>
            <div className="text-sm text-zinc-200">
              {task.assignee ?? <span className="text-zinc-600 italic">未割り当て</span>}
            </div>
          </div>

          {/* Skills */}
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

          {/* Blocked by */}
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

          {/* Created at */}
          <div className="text-[11px] text-zinc-600 text-right">{createdAt}</div>
        </div>
      </div>
    </div>
  );
}

// ─── TaskCard ──────────────────────────────────────────────────────────────

function TaskCard({
  task,
  pendingApprovals,
  onApprovalBadgeClick,
  onDelete,
  onCardClick,
}: {
  task: Task;
  pendingApprovals: ApprovalCard[];
  onApprovalBadgeClick: (card: ApprovalCard) => void;
  onDelete?: () => void;
  onCardClick: (task: Task) => void;
}) {
  const count = pendingApprovals.length;

  return (
    <div
      className="rounded-xl border border-zinc-700/60 bg-zinc-900 p-3 space-y-2 text-sm cursor-pointer hover:border-zinc-600 hover:bg-zinc-900/80 active:scale-[0.98] transition-all"
      onClick={() => onCardClick(task)}
    >
      {/* Title + priority + delete */}
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

      {/* Approval badge */}
      {count > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onApprovalBadgeClick(pendingApprovals[0]); }}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium hover:bg-amber-500/20 active:scale-95 transition-all w-full"
        >
          <span>⚠️</span>
          <span>承認 {count}件</span>
        </button>
      )}

      {/* Skills */}
      {task.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.skills.map((s) => (
            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Footer: id + assignee */}
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

// ─── MissionSelector ───────────────────────────────────────────────────────

function MissionSelector({
  missions,
  selected,
  onChange,
}: {
  missions: Mission[];
  selected: string | null;
  onChange: (slug: string | null) => void;
}) {
  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-zinc-500 transition-colors max-w-[200px] truncate"
    >
      <option value="">All missions</option>
      {missions.map((m) => (
        <option key={m.slug} value={m.slug}>
          {m.title}
        </option>
      ))}
    </select>
  );
}

// ─── RequestFormModal ──────────────────────────────────────────────────────

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

  const toggleSkill = (skill: string) =>
    setSkills((prev) => prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]);

  const handleSubmit = async () => {
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    if (!body.trim()) { setError("依頼内容を入力してください"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitRequest({
        title: title.trim(), body: body.trim(), priority,
        skills, target_dir: targetDir.trim(), deadline_note: deadlineNote.trim(),
      });
      if ("error" in result) { setError(result.error); return; }
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
            <h2 className="text-white font-semibold text-base">Director に依頼</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">タイトル <span className="text-red-400">*</span></div>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="例: ログビューアにフィルタ機能を追加"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">依頼内容 <span className="text-red-400">*</span></div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="詳細な依頼内容を記載してください" rows={4}
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600 resize-none" />
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">優先度</div>
            <div className="flex gap-2">
              {(["high", "medium", "low"] as const).map((p) => (
                <button key={p} onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${priority === p ? PRIORITY_BADGE[p] : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">スキル</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SKILLS.map((skill) => (
                <button key={skill} onClick={() => toggleSkill(skill)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${skills.includes(skill) ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"}`}>
                  {skill}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">target_dir（任意）</div>
            <input value={targetDir} onChange={(e) => setTargetDir(e.target.value)}
              placeholder="/Users/tyz/workspace/..."
              className="w-full bg-transparent text-sm text-zinc-400 outline-none placeholder:text-zinc-600 font-mono" />
          </div>

          <div className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">締切メモ（任意）</div>
            <input value={deadlineNote} onChange={(e) => setDeadlineNote(e.target.value)}
              placeholder="例: 今週中に"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button onClick={onClose}
              className="py-3 rounded-xl bg-zinc-700/50 border border-zinc-600 text-zinc-400 font-semibold hover:bg-zinc-700 active:scale-95 transition-all">
              キャンセル
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? "送信中..." : "依頼を送信"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ─────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm px-4 py-2.5 rounded-xl shadow-2xl">
      {message}
    </div>
  );
}

// ─── AgentStatusBar ────────────────────────────────────────────────────────

const STALE_THRESHOLD_S = 120;

function elapsedLabel(lastSeen: string): string {
  const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m`;
}

function AgentStatusBar({
  agents,
  pendingCards,
  onApprovalClick,
}: {
  agents: AgentStatus[];
  pendingCards: ApprovalCard[];
  onApprovalClick: (card: ApprovalCard) => void;
}) {
  if (agents.length === 0) return null;

  // 後方互換: Redis に "orchestrator" が残っている場合も director として扱う
  const isDirector = (a: AgentStatus) => a.role === "director" || a.role === "orchestrator";
  const directors = agents.filter(isDirector);
  const workers = agents.filter((a) => !isDirector(a));

  const renderAgent = (agent: AgentStatus) => {
    const elapsed = Math.floor(
      (Date.now() - new Date(agent.last_seen).getTime()) / 1000
    );
    const stale = elapsed > STALE_THRESHOLD_S;
    const agentPending = pendingCards.filter((c) => c.agent === agent.name);

    return (
      <div
        key={agent.name}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border shrink-0 transition-opacity ${
          stale
            ? "border-zinc-800 bg-zinc-900/50 opacity-40"
            : "border-zinc-700 bg-zinc-900"
        }`}
      >
        {/* Status dot */}
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            stale ? "bg-zinc-600" : isDirector(agent) ? "bg-violet-400" : "bg-emerald-400"
          }`}
        />

        {/* Name */}
        <span className={`text-[11px] font-semibold ${stale ? "text-zinc-600" : "text-zinc-300"}`}>
          {agent.name}
        </span>

        {/* Role badge for director */}
        {isDirector(agent) && (
          <span className="text-[9px] px-1 py-px rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium leading-none">
            dir
          </span>
        )}

        {/* Current task */}
        {agent.current_task_title && (
          <span className={`text-[10px] max-w-[120px] truncate ${stale ? "text-zinc-700" : "text-zinc-500"}`}>
            {agent.current_task_title}
          </span>
        )}

        {/* Pending approval badge */}
        {agentPending.length > 0 && (
          <button
            onClick={() => onApprovalClick(agentPending[0])}
            title={`承認待ち: ${agentPending[0].tool}`}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[9px] font-bold hover:bg-amber-500/30 active:scale-95 transition-all animate-pulse"
          >
            ⏳ {agentPending.length}
          </button>
        )}

        {/* Elapsed */}
        <span className={`text-[10px] ml-1 ${stale ? "text-zinc-700" : "text-zinc-600"}`}>
          {elapsedLabel(agent.last_seen)}
        </span>
      </div>
    );
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm px-3 py-3">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider shrink-0 pr-1 border-r border-zinc-800">
          Agents
        </span>
        {directors.map(renderAgent)}
        {directors.length > 0 && workers.length > 0 && (
          <div className="w-px h-4 bg-zinc-800 shrink-0" />
        )}
        {workers.map(renderAgent)}
      </div>
    </div>
  );
}

// ─── LogsView ──────────────────────────────────────────────────────────────

function LogsView({ logs, loading }: { logs: LogEntry[]; loading: boolean }) {
  if (loading) return <div className="text-zinc-600 text-xs text-center py-12">Loading logs…</div>;
  if (logs.length === 0) return (
    <div className="text-zinc-700 text-xs text-center py-12">
      No logs yet. Agents post knowledge and improvements via POST /api/log.
    </div>
  );

  const groups = new Map<string, LogEntry[]>();
  for (const log of logs) {
    const key = `${log.task_id ?? "no-task"}|${log.task_title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(log);
  }

  return (
    <div className="p-3 space-y-4">
      {Array.from(groups.entries()).map(([key, group]) => {
        const { task_title, task_id } = group[0];
        return (
          <section key={key} className="space-y-2">
            <header className="flex items-baseline gap-2 border-b border-zinc-800 pb-1">
              <h3 className="text-[13px] font-semibold text-zinc-200 truncate">{task_title}</h3>
              {task_id && <code className="text-[10px] text-zinc-500">{task_id}</code>}
              <span className="text-[10px] text-zinc-600 ml-auto">{group.length}</span>
            </header>
            <div className="space-y-1.5">
              {group.map((log, i) => {
                const time = new Date(log.timestamp).toTimeString().slice(0, 5);
                return (
                  <div key={i} className={`rounded-lg border p-2.5 text-xs space-y-1 ${LOG_TYPE_COLOR[log.type]}`}>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="text-sm leading-none">{LOG_TYPE_ICON[log.type]}</span>
                      <span className="text-zinc-400">{log.agent}</span>
                      <span className="text-zinc-600 ml-auto">{time}</span>
                    </div>
                    <p className="text-zinc-200 whitespace-pre-wrap break-words">{log.content}</p>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── KanbanPage ────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [requests, setRequests] = useState<MissionRequest[]>([]);
  const [approvalCards, setApprovalCards] = useState<ApprovalCard[]>([]);
  const [activeApproval, setActiveApproval] = useState<ApprovalCard | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);

  // Fetch missions once on mount
  useEffect(() => {
    fetchMissions().then((data) => {
      setMissions(data);
      if (data.length > 0 && selectedMission === null) {
        setSelectedMission(data[0].slug);
      }
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch tasks whenever selectedMission changes
  const loadTasks = useCallback(async (): Promise<Task[]> => {
    if (!selectedMission) {
      // All missions: fetch and merge
      const allMissions = await fetchMissions();
      const results = await Promise.all(allMissions.map((m) => fetchMissionTasks(m.slug)));
      const merged = results.flat();
      setTasks(merged);
      setLoading(false);
      return merged;
    }
    const data = await fetchMissionTasks(selectedMission);
    setTasks(data);
    setLoading(false);
    return data;
  }, [selectedMission]);

  // Smart Polling for board tab
  useEffect(() => {
    if (tab !== "board") return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    setLoading(true);

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      const latest = await loadTasks();
      if (cancelled) return;
      const hasActive = latest.some((t) => t.status === "in_progress");
      const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
      timer = setTimeout(tick, delay);
    };

    tick();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        tick();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTasks, tab]);

  // Logs: fetch once on tab switch
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/logs");
      if (!res.ok) { setLogs([]); return; }
      const data = await res.json();
      setLogs(data.logs as LogEntry[]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "logs") fetchLogs();
  }, [tab, fetchLogs]);

  // Approval cards: medium-frequency polling
  const fetchApprovals = useCallback(async () => {
    const data = await fetchApprovalCards();
    setApprovalCards(data.filter((c) => c.status === "pending"));
  }, []);

  useEffect(() => {
    fetchApprovals();
    const t = setInterval(fetchApprovals, POLL_ACTIVE_MS);
    return () => clearInterval(t);
  }, [fetchApprovals]);

  const handleApprovalDone = useCallback((action: "approved" | "denied") => {
    setActiveApproval((current) => {
      const remaining = approvalCards
        .filter((c) => c.id !== current?.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return remaining.length > 0 ? remaining[0] : null;
    });
    setToast(action === "approved" ? "✅ 承認しました" : "❌ 拒否しました");
    fetchApprovals();
  }, [approvalCards, fetchApprovals]);

  // Agents: 5-second polling
  const fetchAgentsData = useCallback(async () => {
    const data = await fetchAgents();
    setAgents(data);
  }, []);

  useEffect(() => {
    fetchAgentsData();
    const t = setInterval(fetchAgentsData, 5000);
    return () => clearInterval(t);
  }, [fetchAgentsData]);

  // Requests: low-frequency polling
  const fetchReqs = useCallback(async () => {
    const data = await fetchRequestsAction();
    setRequests(data);
  }, []);

  useEffect(() => {
    fetchReqs();
    const t = setInterval(fetchReqs, POLL_IDLE_MS);
    return () => clearInterval(t);
  }, [fetchReqs]);

  const handleSubmitted = useCallback((id: string) => {
    setShowRequestForm(false);
    setToast(`リクエスト #${id} を送信しました`);
    fetchReqs();
  }, [fetchReqs]);

  const handleApprovalDeleted = useCallback(() => {
    setActiveApproval((current) => {
      const remaining = approvalCards
        .filter((c) => c.id !== current?.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return remaining.length > 0 ? remaining[0] : null;
    });
    setToast("🗑 カードを削除しました");
    fetchApprovals();
  }, [fetchApprovals]);

  const handleCleanup = useCallback(async () => {
    const result = await cleanupOrphanCards();
    setToast(result.cleaned > 0 ? `🧹 孤児カード ${result.cleaned}件を掃除しました` : "孤児カードはありませんでした");
    fetchApprovals();
  }, [fetchApprovals]);

  const handleDeleteTask = useCallback(async (slug: string, taskId: string) => {
    if (!confirm(`タスク "${taskId}" を削除しますか？`)) return;
    await deleteMissionTask(slug, taskId);
    setToast(`🗑 タスク ${taskId} を削除しました`);
    loadTasks();
  }, [loadTasks]);

  const handleDeleteMission = useCallback(async (slug: string) => {
    const mission = missions.find((m) => m.slug === slug);
    const label = mission ? mission.title : slug;
    if (!confirm(`ミッション「${label}」とその全タスクを削除しますか？\nこの操作は元に戻せません。`)) return;
    await deleteMission(slug);
    setToast(`🗑 ミッション「${label}」を削除しました`);
    const updated = await fetchMissions();
    setMissions(updated);
    setSelectedMission(updated.length > 0 ? updated[0].slug : null);
  }, [missions]);

  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const pendingRequests = requests.filter((r) => r.status === "pending").length;
  const pendingApprovalCount = approvalCards.length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-20">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">
            <h1 className="font-bold text-base tracking-tight">Taskvia</h1>
            <p className="text-[11px] text-zinc-500">Task Board</p>
          </div>
          <MissionSelector
            missions={missions}
            selected={selectedMission}
            onChange={setSelectedMission}
          />
          {selectedMission && (
            <button
              onClick={() => handleDeleteMission(selectedMission)}
              title="このミッションを削除"
              className="text-zinc-700 hover:text-red-400 text-sm leading-none transition-colors shrink-0"
            >
              🗑
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {inProgressCount > 0 && (
            <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {inProgressCount}
            </span>
          )}
          {pendingRequests > 0 && (
            <span className="bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingRequests}
            </span>
          )}
          {pendingApprovalCount > 0 ? (
            <button
              onClick={() => setActiveApproval(approvalCards[0])}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-300 text-sm font-bold hover:bg-amber-500/30 active:scale-95 transition-all animate-pulse shadow-lg shadow-amber-500/20"
            >
              <span>⚠️</span>
              <span>承認 {pendingApprovalCount}件</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-600 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              承認待ちなし
            </span>
          )}
          <button
            onClick={handleCleanup}
            title="TTL 切れで残った孤児カードを index から掃除"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-600 text-xs font-medium hover:border-zinc-600 hover:text-zinc-400 active:scale-95 transition-all hidden sm:block"
          >
            🧹
          </button>
          <div className={`w-2 h-2 rounded-full ${loading ? "bg-zinc-600" : "bg-emerald-400"}`} />
          <button
            onClick={() => setShowRequestForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 active:scale-95 transition-all"
          >
            <span>＋</span>
            <span className="hidden sm:inline">依頼</span>
          </button>
        </div>
      </header>


      {/* Tab switcher */}
      <nav className="border-b border-zinc-800 px-4 flex gap-1">
        {(["board", "logs"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              tab === key
                ? "text-white border-b-2 border-emerald-400"
                : "text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent"
            }`}
          >
            {key === "board" ? "Board" : "Logs"}
          </button>
        ))}
      </nav>

      {/* Board */}
      {tab === "board" && (
        <div className="grid grid-cols-4 gap-px bg-zinc-800 min-h-[calc(100vh-97px)]">
          {TASK_COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            return (
              <div key={col.status} className="bg-zinc-950 p-3 space-y-2 min-w-0">
                <div className="flex items-center gap-1.5 mb-3">
                  <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wider truncate ${col.color}`}>
                    {col.label}
                  </span>
                  <span className="text-[11px] text-zinc-600 ml-auto shrink-0">{colTasks.length}</span>
                </div>
                {colTasks.length === 0 ? (
                  <div className="text-zinc-700 text-xs text-center py-6">—</div>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      pendingApprovals={approvalCards.filter((c) => c.task_id === task.id)}
                      onApprovalBadgeClick={setActiveApproval}
                      onDelete={selectedMission ? () => handleDeleteTask(selectedMission, task.id) : undefined}
                      onCardClick={setSelectedTask}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Logs */}
      {tab === "logs" && (
        <div className="min-h-[calc(100vh-97px)] bg-zinc-950">
          <LogsView logs={logs} loading={logsLoading} />
        </div>
      )}

      {/* Task Detail Dialog */}
      {selectedTask && (
        <TaskDetailDialog
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Approval Modal */}
      {activeApproval && (
        <ApprovalModal
          key={activeApproval.id}
          card={activeApproval}
          onClose={() => setActiveApproval(null)}
          onDone={handleApprovalDone}
          onDeleted={handleApprovalDeleted}
          remainingCount={approvalCards.filter((c) => c.id !== activeApproval.id).length}
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
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* Approval Banner (fixed bottom, above Agent Status Bar) */}
      {pendingApprovalCount > 0 && (
        <div className="fixed bottom-14 left-0 right-0 z-50 bg-amber-500/10 border-t border-amber-500/30 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-lg shrink-0">⚠️</span>
            <div className="min-w-0">
              <p className="text-amber-300 text-sm font-bold">承認待ちが {pendingApprovalCount}件あります</p>
              {approvalCards[0] && (
                <p className="text-amber-400/70 text-xs truncate mt-0.5">{approvalCards[0].agent} — <code className="text-amber-400/80">{approvalCards[0].tool}</code></p>
              )}
            </div>
          </div>
          <button
            onClick={() => setActiveApproval(approvalCards[0])}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/30 border border-amber-500/50 text-amber-300 text-sm font-bold hover:bg-amber-500/40 active:scale-95 transition-all"
          >
            確認する →
          </button>
        </div>
      )}

      {/* Agent Status Bar */}
      <AgentStatusBar
        agents={agents}
        pendingCards={approvalCards}
        onApprovalClick={setActiveApproval}
      />
    </div>
  );
}
