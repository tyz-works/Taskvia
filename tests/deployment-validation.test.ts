// tests/deployment-validation.test.ts
//
// task_153 Phase1(Worf) RED: Phase 0 DoD #6(設計書 §20 line1036)
// 「3 owner の実 identity / alert destination が未設定なら deployment validation が失敗する」
// の契約を検証する。
//
// §17.2 line943 が Taskvia Operator / Backup Owner / Security Owner の 3 役割を規定しており、
// 各 owner は identity(誰か) と alert destination(どこへ通知するか) の 2 項目を持つ。
//
// .env* は読まない — 検証対象は純粋関数であり、env は引数として注入する。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ALL_KEYS = [
  "TASKVIA_OPERATOR_ID",
  "TASKVIA_OPERATOR_ALERT",
  "TASKVIA_BACKUP_OWNER_ID",
  "TASKVIA_BACKUP_OWNER_ALERT",
  "TASKVIA_SECURITY_OWNER_ID",
  "TASKVIA_SECURITY_OWNER_ALERT",
] as const;

function validEnv(): Record<string, string> {
  return {
    TASKVIA_OPERATOR_ID: "tkadmin",
    TASKVIA_OPERATOR_ALERT: "ntfy://taskvia-ops",
    TASKVIA_BACKUP_OWNER_ID: "tkadmin",
    TASKVIA_BACKUP_OWNER_ALERT: "ntfy://taskvia-ops",
    TASKVIA_SECURITY_OWNER_ID: "tkadmin",
    TASKVIA_SECURITY_OWNER_ALERT: "ntfy://taskvia-ops",
  };
}

describe("validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証", () => {
  it("6 項目すべてが実値なら ok=true・missing は空", async () => {
    const { validateDeploymentOwners } = await import("@/lib/deployment-validation");
    const result = validateDeploymentOwners(validEnv());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it.each(ALL_KEYS)("%s が未設定なら ok=false で missing に含まれる", async (key) => {
    const { validateDeploymentOwners } = await import("@/lib/deployment-validation");
    const env = validEnv();
    delete (env as Record<string, string | undefined>)[key];
    const result = validateDeploymentOwners(env);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain(key);
  });

  it.each(ALL_KEYS)("%s が空白のみなら未設定として扱う", async (key) => {
    const { validateDeploymentOwners } = await import("@/lib/deployment-validation");
    const env = validEnv();
    env[key] = "   ";
    const result = validateDeploymentOwners(env);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain(key);
  });

  it.each(["TODO", "todo", "changeme", "CHANGEME", "unset"])(
    "プレースホルダ値 %s は未設定として扱う",
    async (placeholder) => {
      const { validateDeploymentOwners } = await import("@/lib/deployment-validation");
      const env = validEnv();
      env.TASKVIA_OPERATOR_ID = placeholder;
      const result = validateDeploymentOwners(env);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("TASKVIA_OPERATOR_ID");
    },
  );

  it("task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の素通り防止)", async () => {
    const { validateDeploymentOwners } = await import("@/lib/deployment-validation");
    const env = validEnv();
    env.TASKVIA_BACKUP_OWNER_ID = "backup_owner";
    const result = validateDeploymentOwners(env);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("TASKVIA_BACKUP_OWNER_ID");
  });

  it("複数欠落時は missing にすべて列挙される", async () => {
    const { validateDeploymentOwners } = await import("@/lib/deployment-validation");
    const result = validateDeploymentOwners({});
    expect(result.ok).toBe(false);
    expect(result.missing.sort()).toEqual([...ALL_KEYS].sort());
  });
});

// /api/health への統合: 既存 fail-fast(TASKVIA_TOKEN 未設定 → 503)と同じ場所で
// owner validation の失敗も 503 にする。DoD #6 の「deployment validation が失敗する」の実体。
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({ set: vi.fn().mockResolvedValue("OK"), get: vi.fn().mockResolvedValue("ok") }) },
}));

describe("/api/health: owner 未設定で deployment validation が失敗する", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  function stubValidOwners() {
    vi.stubEnv("TASKVIA_OPERATOR_ID", "tkadmin");
    vi.stubEnv("TASKVIA_OPERATOR_ALERT", "ntfy://taskvia-ops");
    vi.stubEnv("TASKVIA_BACKUP_OWNER_ID", "tkadmin");
    vi.stubEnv("TASKVIA_BACKUP_OWNER_ALERT", "ntfy://taskvia-ops");
    vi.stubEnv("TASKVIA_SECURITY_OWNER_ID", "tkadmin");
    vi.stubEnv("TASKVIA_SECURITY_OWNER_ALERT", "ntfy://taskvia-ops");
  }

  it("owner 6 項目が揃い TASKVIA_TOKEN もあれば 200", async () => {
    vi.stubEnv("TASKVIA_TOKEN", "real-token");
    stubValidOwners();
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("TASKVIA_TOKEN があっても owner が未設定なら 503", async () => {
    vi.stubEnv("TASKVIA_TOKEN", "real-token");
    vi.stubEnv("TASKVIA_OPERATOR_ID", "");
    vi.stubEnv("TASKVIA_OPERATOR_ALERT", "");
    vi.stubEnv("TASKVIA_BACKUP_OWNER_ID", "");
    vi.stubEnv("TASKVIA_BACKUP_OWNER_ALERT", "");
    vi.stubEnv("TASKVIA_SECURITY_OWNER_ID", "");
    vi.stubEnv("TASKVIA_SECURITY_OWNER_ALERT", "");
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("503 応答に欠落した変数名は含めるが、値・token・接続文字列は含めない(§14.2 の情報漏洩禁止)", async () => {
    vi.stubEnv("TASKVIA_TOKEN", "super-secret-token-value");
    vi.stubEnv("TASKVIA_OPERATOR_ID", "");
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const text = JSON.stringify(await res.json());
    expect(text).toContain("TASKVIA_OPERATOR_ID");
    expect(text).not.toContain("super-secret-token-value");
  });
});
