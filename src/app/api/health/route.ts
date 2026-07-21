import { Redis } from "@upstash/redis";
import { validateDeploymentOwners } from "@/lib/deployment-validation";

const redis = Redis.fromEnv();

// ②fail-fast(§15.1 line801): TASKVIA_TOKEN が未設定/空白のみなら deployment health
// check を失敗させる。src/lib/auth.ts の open mode(未設定なら全許可)自体は他endpoint
// への影響が大きいため本タスクでは変更しない — health check という「気づける場所」
// を fail-fast の実体にする(task_150計画書・Worf findings 参照)。
//
// task_153 DoD#6: 3 owner(Operator/Backup Owner/Security Owner)の identity/alert
// destination が未設定なら同じ場所・同じ形(503)で失敗させる。応答には欠落した
// 変数名のみを載せ、値・token・接続文字列・stack は載せない(§14.2 情報漏洩禁止)。
export async function GET() {
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();
  if (!token) {
    return Response.json(
      { status: "fail-fast", reason: "TASKVIA_TOKEN is not configured" },
      { status: 503 },
    );
  }

  const owners = validateDeploymentOwners(process.env);
  if (!owners.ok) {
    return Response.json(
      { status: "fail-fast", reason: "deployment owners are not configured", missing: owners.missing },
      { status: 503 },
    );
  }

  await redis.set("health", "ok");
  const val = await redis.get("health");
  return Response.json({ status: val });
}
