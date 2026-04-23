import { redirect } from "next/navigation";
import {
  fetchMissions,
  fetchVerificationQueue,
  type VerificationRecord,
} from "../actions";

// ─── Verification badge (mirrors page.tsx inline pattern) ──────────────────

type VerificationBadgeStatus = "pending" | "verifying" | "verified" | "failed" | "rework";

const VERIFICATION_BADGE: Record<VerificationBadgeStatus, string> = {
  pending:   "bg-zinc-700/20 text-zinc-500 border-zinc-600",
  verifying: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  verified:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  rework:    "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const VERIFICATION_LABEL: Record<VerificationBadgeStatus, string> = {
  pending:   "Pending",
  verifying: "Verifying",
  verified:  "Verified",
  failed:    "Failed",
  rework:    "Rework",
};

// W-1: exhaustive switch — TS errors if VerificationBadgeStatus grows without update
function verificationIcon(s: VerificationBadgeStatus): string {
  switch (s) {
    case "pending":   return "○";
    case "verifying": return "⟳";
    case "verified":  return "✓";
    case "failed":    return "✗";
    case "rework":    return "↩";
    default: {
      const _exhaustive: never = s;
      throw new Error("unhandled verification status: " + _exhaustive);
    }
  }
}

function toStatus(r: VerificationRecord): VerificationBadgeStatus {
  if (r.verdict === "pass") return "verified";
  return r.rework_count > 0 ? "rework" : "failed";
}

const STATUS_ORDER: VerificationBadgeStatus[] = ["verifying", "failed", "rework", "verified", "pending"];

function sortByStatus(a: VerificationRecord, b: VerificationRecord): number {
  return STATUS_ORDER.indexOf(toStatus(a)) - STATUS_ORDER.indexOf(toStatus(b));
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function VerificationQueuePage() {
  if (process.env.CREWVIA_VERIFICATION_UI === "disabled") {
    redirect("/");
  }

  const missions = await fetchMissions();

  const missionQueues = await Promise.all(
    missions.map(async (m) => {
      const records = await fetchVerificationQueue(m.slug);
      return { mission: m, records: records.sort(sortByStatus) };
    })
  );

  const nonEmpty = missionQueues.filter((mq) => mq.records.length > 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      {/* Header nav */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <a
          href="/"
          className="text-zinc-500 hover:text-zinc-300 text-[11px] font-semibold uppercase tracking-wider transition-colors"
        >
          ← Board
        </a>
        <span className="text-zinc-700">|</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 border-b-2 border-sky-400 pb-0.5">
          Verification Queue
        </span>
      </header>

      <main className="p-4 space-y-6 max-w-4xl mx-auto">
        {nonEmpty.length === 0 ? (
          <div className="mt-20 text-center">
            <p className="text-zinc-600 text-sm">No verification records found.</p>
            <p className="text-zinc-700 text-[11px] mt-1">Records appear here when tasks complete verification.</p>
          </div>
        ) : (
          nonEmpty.map(({ mission, records }) => (
            <section key={mission.slug}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
                <span>{mission.title}</span>
                <span className="text-zinc-700">({records.length})</span>
              </h2>
              <div className="space-y-1.5">
                {records.map((r) => {
                  const status = toStatus(r);
                  const badgeCls = VERIFICATION_BADGE[status];
                  return (
                    <div
                      key={r.task_id}
                      className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-2"
                    >
                      {/* Badge */}
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badgeCls} shrink-0`}
                        aria-label={VERIFICATION_LABEL[status]}
                      >
                        <span aria-hidden="true">{verificationIcon(status)}</span>
                        {VERIFICATION_LABEL[status]}
                      </span>

                      {/* Task ID */}
                      <span className="text-zinc-300 text-xs font-mono truncate flex-1">
                        {r.task_id}
                      </span>

                      {/* Mode */}
                      <span className="text-zinc-600 text-[10px] shrink-0">{r.mode}</span>

                      {/* Rework count */}
                      {r.rework_count > 0 && (
                        <span className="text-orange-400 text-[10px] shrink-0">
                          rework: {r.rework_count}/{r.max_rework ?? 3}
                        </span>
                      )}

                      {/* Verifier */}
                      {r.verifier && (
                        <span className="text-zinc-600 text-[10px] shrink-0 truncate max-w-[80px]">
                          {r.verifier}
                        </span>
                      )}

                      {/* Time */}
                      <span className="text-zinc-700 text-[10px] shrink-0">
                        {r.verified_at
                          ? new Date(r.verified_at).toLocaleString("ja-JP", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : new Date(r.received_at).toLocaleString("ja-JP", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
