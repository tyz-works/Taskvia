// src/app/api/missions/[slug]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { notFound } from "@/lib/responses";
import { parseRedisValue } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

// DELETE /api/missions/[slug] — mission と配下タスクを全削除
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug } = await params;
  const taskIds = await redis.lrange<string>(`mission:${slug}:tasks:index`, 0, -1);

  await Promise.all([
    ...taskIds.map((id) => redis.del(`mission:${slug}:tasks:${id}`)),
    redis.del(`mission:${slug}:tasks:index`),
    redis.del(`mission:${slug}`),
    redis.lrem("mission:index", 1, slug),
  ]);

  return Response.json({ ok: true });
}

// PATCH /api/missions/[slug] — mission 更新 (status)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug } = await params;
  const raw = await redis.get<string | object>(`mission:${slug}`);

  if (!raw) return notFound("Mission not found");

  const mission = parseRedisValue<Record<string, unknown>>(raw)!;
  const body = await req.json();

  if (body.status !== undefined) mission.status = body.status;
  mission.updated_at = new Date().toISOString();

  await redis.set(`mission:${slug}`, JSON.stringify(mission));

  return Response.json({ mission });
}
