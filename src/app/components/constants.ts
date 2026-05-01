import type { VerificationRecord } from "../actions";

export const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-zinc-700 text-zinc-400 border-zinc-600",
};

export type VerificationBadgeStatus = "pending" | "verifying" | "verified" | "failed" | "rework";

export const VERIFICATION_BADGE: Record<VerificationBadgeStatus, string> = {
  pending:   "bg-zinc-700/20 text-zinc-500 border-zinc-600",
  verifying: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  verified:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  rework:    "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

export function verificationIcon(s: VerificationBadgeStatus): string {
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

export function toVerificationStatus(r: VerificationRecord | undefined): VerificationBadgeStatus {
  if (!r) return "pending";
  if (r.verdict === "pass") return "verified";
  return r.rework_count > 0 ? "rework" : "failed";
}
