"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchRequests as fetchRequestsAction,
  fetchMissions,
  fetchMissionTasks,
  fetchApprovalCards,
  fetchAgents,
  fetchVerificationRecords,
  getVerificationUIEnabled,
  cleanupOrphanCards,
  deleteMissionTask,
  deleteMission,
  type Mission,
  type Task,
  type ApprovalCard,
  type AgentStatus,
  type VerificationRecord,
} from "./actions";
import type { MissionRequest } from "./api/requests/route";
import { ApprovalModal } from "./components/ApprovalModal";
import { TaskDetailDialog } from "./components/TaskDetailDialog";
import { TaskCard } from "./components/TaskCard";
import { MissionSelector } from "./components/MissionSelector";
import { RequestFormModal } from "./components/RequestFormModal";
import { Toast } from "./components/Toast";
import { AgentStatusBar } from "./components/AgentStatusBar";
import { LogsView, type LogEntry } from "./components/LogsView";

// Smart Polling intervals (ms)
const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 20000;

type Tab = "board" | "logs";

const TASK_COLUMNS: { status: Task["status"]; label: string; color: string; dot: string }[] = [
  { status: "blocked",     label: "Blocked",     color: "text-red-400",     dot: "bg-red-500" },
  { status: "pending",     label: "Backlog",      color: "text-zinc-400",    dot: "bg-zinc-500" },
  { status: "in_progress", label: "In Progress",  color: "text-blue-400",    dot: "bg-blue-400" },
  { status: "done",        label: "Done",         color: "text-emerald-400", dot: "bg-emerald-400" },
];

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
  const [approvalProjectFilter, setApprovalProjectFilter] = useState<string | null>(null);
  const [activeApproval, setActiveApproval] = useState<ApprovalCard | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);

  const [verificationEnabled, setVerificationEnabled] = useState(true);
  const [verificationRecords, setVerificationRecords] = useState<Record<string, VerificationRecord>>({});

  useEffect(() => {
    getVerificationUIEnabled().then(setVerificationEnabled);
  }, []);

  useEffect(() => {
    fetchMissions().then((data) => {
      setMissions(data);
      if (data.length > 0 && selectedMission === null) {
        const firstActive = data.find((m) => m.status !== "done") ?? data[0];
        setSelectedMission(firstActive.slug);
      }
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const loadTasks = useCallback(async (): Promise<Task[]> => {
    if (!selectedMission) {
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

  useEffect(() => {
    if (tab !== "board") return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    setLoading(true);

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;

      const updatedMissions = await fetchMissions();
      if (!cancelled) {
        setMissions(updatedMissions);
        setSelectedMission((current) => {
          if (!current) return current;
          const found = updatedMissions.find((m) => m.slug === current);
          if (found && found.status !== "done") return current;
          const firstActive = updatedMissions.find((m) => m.status !== "done");
          return firstActive ? firstActive.slug : null;
        });
      }

      const latest = await loadTasks();
      if (cancelled) return;

      let vRecords: Record<string, VerificationRecord> = {};
      if (verificationEnabled && latest.length > 0) {
        vRecords = await fetchVerificationRecords(latest.map((t) => t.id));
        if (!cancelled) setVerificationRecords(vRecords);
      }

      const verificationActive = latest.some(
        (t) => t.status === "in_progress" && !vRecords[t.id]
      );
      const hasActive = latest.some((t) => t.status === "in_progress") || verificationActive;
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
  }, [loadTasks, tab, verificationEnabled]);

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

  const knownApprovalIds = useRef<Set<string>>(new Set());
  const initialApprovalLoad = useRef(true);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const fetchApprovals = useCallback(async () => {
    const data = await fetchApprovalCards();
    const pending = data.filter((c) => c.status === "pending");
    setApprovalCards(pending);

    if (initialApprovalLoad.current) {
      initialApprovalLoad.current = false;
      for (const c of pending) knownApprovalIds.current.add(c.id);
      if (pending.length > 0) {
        setActiveApproval(pending[0]);
      }
      return;
    }

    const newCards = pending.filter((c) => !knownApprovalIds.current.has(c.id));
    for (const c of pending) knownApprovalIds.current.add(c.id);

    if (newCards.length > 0) {
      setActiveApproval((current) => current ?? newCards[0]);

      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        const card = newCards[0];
        const n = new Notification(`承認要求 — ${card.agent}`, {
          body: card.tool,
          tag: "crewvia-approval",
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }
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

  const fetchAgentsData = useCallback(async () => {
    const data = await fetchAgents();
    setAgents(data);
  }, []);

  useEffect(() => {
    fetchAgentsData();
    const t = setInterval(fetchAgentsData, 5000);
    return () => clearInterval(t);
  }, [fetchAgentsData]);

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
  const filteredApprovalCards = approvalProjectFilter
    ? approvalCards.filter((c) => c.project === approvalProjectFilter)
    : approvalCards;
  const approvalProjects = [...new Set(approvalCards.map((c) => c.project))].sort();
  const pendingApprovalCount = filteredApprovalCards.length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-20">
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
              onClick={() => setActiveApproval(filteredApprovalCards[0])}
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
          {approvalProjects.length > 1 && (
            <select
              value={approvalProjectFilter ?? ""}
              onChange={(e) => setApprovalProjectFilter(e.target.value || null)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px] rounded-lg px-2 py-1.5 outline-none focus:border-zinc-500 transition-colors"
            >
              <option value="">All projects</option>
              {approvalProjects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
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
        {verificationEnabled && (
          <a
            href="/verification-queue"
            className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors text-zinc-500 hover:text-sky-400 border-b-2 border-transparent hover:border-sky-400"
          >
            Verification
          </a>
        )}
      </nav>

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
                      pendingApprovals={filteredApprovalCards.filter((c) => c.task_id === task.id)}
                      verificationRecord={verificationRecords[task.id]}
                      verificationEnabled={verificationEnabled}
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

      {tab === "logs" && (
        <div className="min-h-[calc(100vh-97px)] bg-zinc-950">
          <LogsView logs={logs} loading={logsLoading} />
        </div>
      )}

      {selectedTask && (
        <TaskDetailDialog
          task={selectedTask}
          verificationRecord={verificationRecords[selectedTask.id]}
          verificationEnabled={verificationEnabled}
          onClose={() => setSelectedTask(null)}
        />
      )}

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

      {showRequestForm && (
        <RequestFormModal
          onClose={() => setShowRequestForm(false)}
          onSubmitted={handleSubmitted}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <AgentStatusBar
        agents={agents}
        pendingCards={filteredApprovalCards}
        onApprovalClick={setActiveApproval}
      />
    </div>
  );
}
