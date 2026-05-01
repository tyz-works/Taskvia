// src/app/api/missions/[slug]/tasks/[id]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { notFound } from "@/lib/responses";
import { parseRedisValue } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

// DELETE /api/missions/[slug]/tasks/[id] — task 削除
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug, id } = await params;
  await Promise.all([
    redis.del(`mission:${slug}:tasks:${id}`),
    redis.lrem(`mission:${slug}:tasks:index`, 1, id),
  ]);

  return Response.json({ ok: true });
}

// PATCH /api/missions/[slug]/tasks/[id] — task 更新 (status, assignee, result)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug, id } = await params;
  const raw = await redis.get<string | object>(`mission:${slug}:tasks:${id}`);

  if (!raw) return notFound("Task not found");

  const task = parseRedisValue<Record<string, unknown>>(raw)!;
  const body = await req.json();

  if (body.status !== undefined) task.status = body.status;
  if (body.assignee !== undefined) task.assignee = body.assignee;
  if (body.result !== undefined) task.result = body.result;
  task.updated_at = new Date().toISOString();

  await redis.set(`mission:${slug}:tasks:${id}`, JSON.stringify(task));

  return Response.json({ task });
}
