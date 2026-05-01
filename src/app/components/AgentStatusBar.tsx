"use client";

import { type AgentStatus, type ApprovalCard } from "../actions";

const STALE_THRESHOLD_S = 120;

function elapsedLabel(lastSeen: string): string {
  const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m`;
}

export function AgentStatusBar({
  agents,
  pendingCards,
  onApprovalClick,
}: {
  agents: AgentStatus[];
  pendingCards: ApprovalCard[];
  onApprovalClick: (card: ApprovalCard) => void;
}) {
  if (agents.length === 0) return null;

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
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            stale ? "bg-zinc-600" : isDirector(agent) ? "bg-violet-400" : "bg-emerald-400"
          }`}
        />
        <span className={`text-[11px] font-semibold ${stale ? "text-zinc-600" : "text-zinc-300"}`}>
          {agent.name}
        </span>
        {isDirector(agent) && (
          <span className="text-[9px] px-1 py-px rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium leading-none">
            dir
          </span>
        )}
        {agent.current_task_title && (
          <span className={`text-[10px] max-w-[120px] truncate ${stale ? "text-zinc-700" : "text-zinc-500"}`}>
            {agent.current_task_title}
          </span>
        )}
        {agentPending.length > 0 && (
          <button
            onClick={() => onApprovalClick(agentPending[0])}
            title={`承認待ち: ${agentPending[0].tool}`}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[9px] font-bold hover:bg-amber-500/30 active:scale-95 transition-all animate-pulse"
          >
            ⏳ {agentPending.length}
          </button>
        )}
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
