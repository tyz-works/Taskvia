export type VerificationVerdict = "pass" | "fail";
export type VerificationMode = "light" | "standard" | "strict";

export interface CheckSummary {
  name: string;
  status: "pass" | "fail" | "timeout";
  duration_s?: number;
}

export interface VerificationPayload {
  task_id: string;
  mission_slug?: string;
  mode?: VerificationMode;
  verdict: VerificationVerdict;
  checks: CheckSummary[];
  rework_count?: number;
  verified_at?: string;
  verifier?: string;
}

export const VERIFICATION_TTL = 60 * 60 * 24 * 7; // 7 days
