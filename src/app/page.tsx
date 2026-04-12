"use client";

import { useState, useEffect, useCallback } from "react";
import {
  submitRequest,
  fetchRequests as fetchRequestsAction,
  fetchMissions,
  fetchMissionTasks,
  type Mission,
  type Task,
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

// ─── TaskCard ──────────────────────────────────────────────────────────────

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900 p-3 space-y-2 text-sm">
      {/* Title + priority */}
      <div className="flex items-start gap-2">
        <span className="text-zinc-100 text-xs font-medium leading-snug flex-1">{task.title}</span>
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[task.priority]}`}>
          {task.priority}
        </span>
      </div>

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
            <h2 className="text-white font-semibold text-base">Orchestrator に依頼</h2>
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm px-4 py-2.5 rounded-xl shadow-2xl">
      {message}
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

  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const pendingRequests = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
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
                  colTasks.map((task) => <TaskCard key={task.id} task={task} />)
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

      {/* Request Form Modal */}
      {showRequestForm && (
        <RequestFormModal
          onClose={() => setShowRequestForm(false)}
          onSubmitted={handleSubmitted}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
