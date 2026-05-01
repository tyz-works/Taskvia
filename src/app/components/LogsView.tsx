"use client";

export interface LogEntry {
  type: "knowledge" | "improvement" | "work";
  content: string;
  task_title: string;
  task_id: string | null;
  agent: string;
  timestamp: string;
}

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

export function LogsView({ logs, loading }: { logs: LogEntry[]; loading: boolean }) {
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
