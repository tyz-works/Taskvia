// task_153: Phase 0 DoD #6(設計書 §20 line1036)
// 「3 owner の実 identity / alert destination が未設定なら deployment validation が失敗する」
//
// §17.2 line943 が規定する 3 役割 — Taskvia Operator / Backup Owner / Security Owner —
// それぞれの identity と alert destination を必須にする。
// 純粋関数として env を引数で受け取り、process.env に直接依存しない(テスト容易性)。

export const OWNER_ENV_KEYS = [
  "TASKVIA_OPERATOR_ID",
  "TASKVIA_OPERATOR_ALERT",
  "TASKVIA_BACKUP_OWNER_ID",
  "TASKVIA_BACKUP_OWNER_ALERT",
  "TASKVIA_SECURITY_OWNER_ID",
  "TASKVIA_SECURITY_OWNER_ALERT",
] as const;

// 「設定されているが実運用では無意味」な値を未設定と同じに扱う。
// backup_owner は ops/backup.sh:6 の既定値であり、これを許すと DoD #6 が素通りする。
const PLACEHOLDER_VALUES = new Set(["todo", "changeme", "unset", "backup_owner"]);

export function validateDeploymentOwners(
  env: Record<string, string | undefined>,
): { ok: boolean; missing: string[] } {
  const missing = OWNER_ENV_KEYS.filter((key) => {
    const value = (env[key] ?? "").trim();
    return value === "" || PLACEHOLDER_VALUES.has(value.toLowerCase());
  });
  return { ok: missing.length === 0, missing: [...missing] };
}
