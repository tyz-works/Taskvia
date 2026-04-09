// src/app/api/log/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { type, content, task_title, task_id, agent } = await req.json();

  const entry = {
    type: type ?? "work",
    content,
    task_title: task_title ?? "Unknown task",
    task_id: task_id ?? null,
    agent: agent ?? "Unknown agent",
    timestamp: new Date().toISOString(),
  };

  await redis.lpush("agent:logs", JSON.stringify(entry));

  return Response.json({ ok: true });
}
