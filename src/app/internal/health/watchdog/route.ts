// src/app/internal/health/watchdog/route.ts
//
// ③watchdog集約endpoint(§14.2 line780-789): docker/Caddyfileがgateway 443経由で
// この経路をproxyする(reverse_proxy taskvia:3000)。認証は watchdog scope token
// (TASKVIA_WATCHDOG_TOKEN)をtiming-safeに検証し、依存先(Redis等)の障害有無に
// 関わらず認証を必ず先に確定させる — 未認証リクエストへ障害詳細を漏らさないため。
//
// 認証失敗時のレスポンスは接続文字列・内部hostname・versionノ詳細・error stackの
// いずれも含めない(§14.2の禁止事項)。
import { timingSafeEqual, createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

type DependencyStatus = "healthy" | "degraded" | "unreachable";

function timingSafeTokenEqual(presented: string, expected: string): boolean {
  // 長さの異なる文字列同士は timingSafeEqual がそのまま throw するため、
  // 固定長へ正規化した digest 同士を比較する(timing-safe性を保ったまま任意長を扱う)。
  const presentedDigest = createHash("sha256").update(presented).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

function unauthorizedWatchdog(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request): Promise<Response> {
  const expectedToken = (process.env.TASKVIA_WATCHDOG_TOKEN ?? "").trim();
  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  // 認証は依存先チェックより必ず先に確定する。依存先が落ちていても401が優先される。
  if (!expectedToken || !presentedToken || !timingSafeTokenEqual(presentedToken, expectedToken)) {
    return unauthorizedWatchdog();
  }

  let redisStatus: DependencyStatus;
  try {
    await redis.get("health");
    redisStatus = "healthy";
  } catch {
    redisStatus = "unreachable";
  }

  // PostgreSQL/n8n: taskviaアプリ層は本MVP(Phase0-1 Docker土台)時点で両者への
  // 接続クライアントを一切持たない(PG正本化はPhase1、n8n連携はPhase4のスコープ)。
  // よってこの2フィールドは実測値ではなく「まだ統合されていない」ことを示す
  // 構造上のplaceholderとして常に"unreachable"を返す — 実際の障害シグナルと
  // 混同しないこと(Phase1/Phase4でクライアントが導入され次第、実チェックに置換する)。
  const postgresStatus: DependencyStatus = "unreachable";
  const n8nStatus: DependencyStatus = "unreachable";

  return Response.json({
    web: "healthy",
    postgres: postgresStatus,
    redis: redisStatus,
    n8n: n8nStatus,
  });
}
