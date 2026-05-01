export type VerificationBadgeStatus = "pending" | "verifying" | "verified" | "failed" | "rework";

export const VERIFICATION_BADGE: Record<VerificationBadgeStatus, string> = {
  pending:   "bg-zinc-700/20 text-zinc-500 border-zinc-600",
  verifying: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  verified:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  rework:    "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

// W-1: exhaustive switch — TS errors if VerificationBadgeStatus grows without this update
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
