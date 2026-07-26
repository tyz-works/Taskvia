// src/app/api/logs/route.ts
//
// カンバン UI の "Logs" タブから呼ばれる。agent:logs list の直近エントリを
// 返却する GET エンドポイント。
//
// 認証: NextAuth session (task_157)。src/proxy.ts の matcher は `/api/**` を対象外と
// しているため(docs/20260720_phase0_auth_gateway_decision.md §1・各 route handler が
// 自分の認証を検証する設計)、matcher には触れず handler 内部で auth() を呼ぶ。
// Bearer(isAuthorized())ではなくsessionにする理由: このエンドポイントの唯一の呼び出し元は
// ログイン済みブラウザの Logs タブ(src/app/page.tsx の client fetch("/api/logs"))であり、
// Authorization ヘッダを送らない。TASKVIA_TOKEN をクライアントへ持たせるのは別の漏洩経路を
// 作るため不可。agent 側は POST /api/log(単数形)を使い、このGETは呼ばない。
//
// クエリパラメータ:
//   ?type=knowledge|improvement|work  - 種別でフィルタ (省略で全件)
//   ?limit=N                           - 取得件数 (1-100、default 100)
import { Redis } from "@upstash/redis";
import { auth } from "@/auth";

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
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
