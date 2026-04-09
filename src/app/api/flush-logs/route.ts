// src/app/api/flush-logs/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return Response.json({ error: "GITHUB_TOKEN not configured" }, { status: 503 });
  }

  const raws = await redis.lrange<string>("agent:logs", 0, -1);
  if (!raws.length) return Response.json({ ok: true, pushed: 0 });

  const entries = raws
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
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
    return Response.json({ error: "GitHub push failed", detail: err }, { status: 502 });
  }

  // push 成功後に削除
  await redis.del("agent:logs");

  return Response.json({ ok: true, pushed: entries.length });
}
