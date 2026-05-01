// src/app/api/approve/[id]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { notFound } from "@/lib/responses";
import { parseRedisValue } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return notFound();

  const card = parseRedisValue<Record<string, unknown>>(raw)!;
  card.status = "approved";
  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });

  return Response.json({ ok: true });
}
