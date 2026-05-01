// src/app/api/flush-logs/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { serviceUnavailable, badGateway } from "@/lib/responses";
import { parseRedisValues } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

/**
 * agent:logs を読み出して tkworks-vault に push する共通処理。
 * POST (手動トリガ) と GET (Vercel Cron 発火) から呼ばれる。
 */
async function flushLogs() {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return serviceUnavailable("GITHUB_TOKEN not configured");
  }

  const raws = await redis.lrange<string>("agent:logs", 0, -1);
  if (!raws.length) return Response.json({ ok: true, pushed: 0 });

  const entries = parseRedisValues<{ type: string; task_id?: string; task_title: string; agent: string; timestamp: string; content: string }>(raws as (string | object | null)[])
    .filter((e) => e.type === "knowledge" || e.type === "improvement");

  if (!entries.length) {
    await redis.del("agent:logs");
    return Response.json({ ok: true, pushed: 0 });
  }

  // タスクごとにグループ化
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.task_id ?? "no-task"}|${e.task_title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`# Agent Knowledge Log - ${today}`, ""];

  for (const [, group] of groups) {
    const { task_title, task_id } = group[0];
    const label = task_id ? `${task_title} (${task_id})` : task_title;
    for (const e of group) {
      const icon = e.type === "improvement" ? "🔧" : "💡";
      const time = new Date(e.timestamp).toTimeString().slice(0, 5);
      lines.push(`## ${icon} ${label}`);
      lines.push(`> ${e.agent} · ${time}`, "");
      lines.push(e.content, "", "---", "");
    }
  }

  const content = lines.join("\n");
  const path = `agent-logs/${today}-knowledge.md`;
  const encoded = Buffer.from(content).toString("base64");

  // 既存ファイルのSHA取得（更新用）
  const getRes = await fetch(
    `https://api.github.com/repos/tyz-works/tkworks-vault/contents/${path}`,
    { headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" } }
  );
  const existing = getRes.ok ? await getRes.json() : null;

  const pushRes = await fetch(
    `https://api.github.com/repos/tyz-works/tkworks-vault/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `agent-log: ${today}`,
        content: encoded,
        ...(existing?.sha ? { sha: existing.sha } : {}),
      }),
    }
  );

  if (!pushRes.ok) {
    const err = await pushRes.text();
    return badGateway("GitHub push failed", err);
  }

  // push 成功後に削除
  await redis.del("agent:logs");

  return Response.json({ ok: true, pushed: entries.length });
}

/**
 * 手動トリガ用 (TASKVIA_TOKEN で認証)。
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  return flushLogs();
}

/**
 * Vercel Cron 発火用 (CRON_SECRET で認証)。
 *
 * Vercel Cron は設定済みの CRON_SECRET を
 * `Authorization: Bearer ${CRON_SECRET}` で自動付与する。
 * CRON_SECRET 未設定時はこの GET は常に 503 を返して失敗させる
 * (cron 側で誤って外部から叩かれるリスクを回避)。
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return serviceUnavailable("CRON_SECRET not configured");
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  return flushLogs();
}
