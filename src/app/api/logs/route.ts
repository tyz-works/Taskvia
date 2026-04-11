// src/app/api/logs/route.ts
//
// カンバン UI の "Logs" タブから呼ばれる。agent:logs list の直近エントリを
// 返却する GET エンドポイント。
//
// 認証: 現時点では無認証 (/api/cards と同じパターン)。
// ⚠️ PR1 (fix/cards-auth) マージ後は src/proxy.ts の matcher に
//    "/api/logs" を追加する follow-up PR が必要。
//    https://github.com/tyz-works/taskvia/pull/4 と一緒に扱うこと。
//
// クエリパラメータ:
//   ?type=knowledge|improvement|work  - 種別でフィルタ (省略で全件)
//   ?limit=N                           - 取得件数 (1-100、default 100)
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

type LogEntry = {
  type: "knowledge" | "improvement" | "work";
  content: string;
  task_title: string;
  task_id: string | null;
  agent: string;
  timestamp: string;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const typeFilter = searchParams.get("type");
  const rawLimit = parseInt(searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, rawLimit))
    : 100;

  const raws = await redis.lrange<string>("agent:logs", 0, limit - 1);
  if (!raws.length) return Response.json({ logs: [] });

  let logs: LogEntry[] = raws.map((r) =>
    typeof r === "string" ? JSON.parse(r) : r
  );

  if (typeFilter) {
    logs = logs.filter((l) => l.type === typeFilter);
  }

  return Response.json({ logs });
}
